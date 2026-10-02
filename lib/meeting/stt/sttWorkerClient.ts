"use client";

/**
 * lib/meeting/stt/sttWorkerClient.ts
 *
 * Main-thread proxies for sttWorker.ts, implementing the SAME interfaces
 * (STTProvider, DiarizationProvider + extractEmbeddingSpans) as
 * localWhisperProvider.ts / localDiarizationProvider.ts, so every existing
 * caller (providerFactory.ts, preloadStt.ts, chunkedLocalTranscription.ts)
 * swaps in the worker-backed version with an import change only — see
 * sttWorker.ts's doc comment for why this exists (keeping the tab's main
 * thread free during long local WASM inference instead of freezing it).
 *
 * One shared Worker per tab (module-level singleton, lazily created) — both
 * providers below talk to it over a tiny request/response protocol keyed by
 * an incrementing id, since a single Worker can interleave multiple
 * in-flight calls (e.g. STT and diarization running concurrently per
 * chunk — see chunkedLocalTranscription.ts).
 */

import type { STTProvider, STTResult, DiarizationProvider, DiarizationResult } from "./types";
import type { RawEmbeddingSpan } from "./diarization/runDiarizationCore";

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  onProgress?: (pct: number) => void;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, PendingCall>();

/** Notified whenever the shared worker dies (error/message-error) and gets
 *  dereferenced — preloadStt.ts uses this to invalidate its cached
 *  "preloaded" provider instances, since a freshly (lazily) re-created
 *  worker has no models loaded and would otherwise be silently handed out
 *  as if it were still warm. */
const resetListeners = new Set<() => void>();
export function onWorkerReset(listener: () => void): () => void {
  resetListeners.add(listener);
  return () => resetListeners.delete(listener);
}

/** Kills the shared worker, rejecting every call still waiting on it, and lets
 *  the next call start a fresh one. This is the only way to stop an inference
 *  that has hung or is far too slow: a worker runs one WASM call to the end and
 *  cannot be interrupted any other way. Models loaded in it are lost, so the
 *  next call reloads them (from the browser cache). */
export function resetSttWorker(reason = "Speech processing was stopped."): void {
  if (!worker) return;
  const error = new Error(reason);
  for (const call of pending.values()) call.reject(error);
  pending.clear();
  worker.terminate();
  worker = null;
  for (const listener of resetListeners) listener();
}

function getWorker(): Worker {
  if (worker) return worker;
  // Next's emitted worker bundle is a self-contained classic worker and its
  // dev runtime loads split chunks with importScripts(). Do not force module
  // mode here: module workers do not expose importScripts and fail before the
  // STT model can initialize.
  worker = new Worker(new URL("./sttWorker.ts", import.meta.url));
  const rejectWorkerCalls = (message: string) => {
    const error = new Error(message);
    for (const call of pending.values()) call.reject(error);
    pending.clear();
    // Terminate the dead worker instead of just dereferencing it — otherwise
    // it (and any model already loaded into it, potentially hundreds of MB)
    // keeps running, unreachable, for the rest of the tab's life.
    worker?.terminate();
    worker = null;
    for (const listener of resetListeners) listener();
  };
  worker.onerror = (event) => {
    const detail = [event.message, event.filename, event.lineno && `line ${event.lineno}`, event.colno && `column ${event.colno}`]
      .filter(Boolean)
      .join(" — ");
    console.error("[meeting] Speech worker error", detail || event);
    rejectWorkerCalls(detail || "Speech worker failed to start.");
  };
  worker.onmessageerror = () => {
    rejectWorkerCalls("Speech worker could not transfer a message.");
  };
  worker.onmessage = (e: MessageEvent<{ id: number; kind: "progress" | "done" | "error"; payload: unknown }>) => {
    const { id, kind, payload } = e.data;
    const call = pending.get(id);
    if (!call) return;
    if (kind === "progress") {
      call.onProgress?.((payload as { pct: number }).pct);
      return;
    }
    pending.delete(id);
    if (kind === "error") call.reject(new Error((payload as { message: string }).message));
    else call.resolve(payload);
  };
  return worker;
}

function callWorker<T>(
  type: "loadWhisper" | "loadDiarization" | "transcribe" | "diarize" | "extractEmbeddingSpans" | "setLanguage",
  payload: unknown,
  onProgress?: (pct: number) => void,
): Promise<T> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress });
    w.postMessage({ id, type, payload });
  });
}

export class WorkerSTTProvider implements STTProvider {
  readonly id = "local-whisper-worker";

  /** Mirrors LocalWhisperProvider.load()'s signature exactly so this is a
   *  drop-in replacement wherever that class was constructed directly. */
  async load(onProgress?: (pct: number) => void): Promise<void> {
    const runtime = await callWorker<{ device: string; dtype: string; logicalCores: number; crossOriginIsolated: boolean }>("loadWhisper", {}, onProgress);
    console.info("[meeting] Whisper worker ready", JSON.stringify(runtime));
  }

  async transcribe(audio: Float32Array, sampleRate: number): Promise<STTResult> {
    return callWorker<STTResult>("transcribe", { audio, sampleRate });
  }

  /** Updates the language on the worker's (possibly already-loaded, e.g.
   *  preloaded) LocalWhisperProvider instance — see that class's
   *  setLanguage() doc comment. */
  async setLanguage(language: string): Promise<void> {
    return callWorker<void>("setLanguage", { language });
  }
}

export class WorkerDiarizationProvider implements DiarizationProvider {
  readonly id = "local-pyannote-wespeaker-worker";

  async load(onProgress?: (pct: number) => void): Promise<void> {
    await callWorker<void>("loadDiarization", {}, onProgress);
  }

  async diarize(audio: Float32Array, sampleRate: number): Promise<DiarizationResult> {
    return callWorker<DiarizationResult>("diarize", { audio, sampleRate });
  }

  /** Used by chunkedLocalTranscription.ts — see runDiarizationCore.ts's
   *  extractEmbeddingSpans doc comment for why clustering stays deferred. */
  async extractEmbeddingSpans(audio: Float32Array, sampleRate: number, timeOffsetSec: number): Promise<RawEmbeddingSpan[]> {
    return callWorker<RawEmbeddingSpan[]>("extractEmbeddingSpans", { audio, sampleRate, timeOffsetSec });
  }
}
