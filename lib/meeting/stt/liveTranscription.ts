"use client";

/** Low-latency transcript preview for local/cloud STT with optional live translation. */

import { decodeAudioTo16kMono } from "./audioDecode";
import { getPreloadedSttProviders } from "./preloadStt";
import { WorkerSTTProvider, resetSttWorker } from "./sttWorkerClient";
import { isMobileDevice } from "./mobileDevice";
import { encodeFloat32AsInt16Pcm } from "./serverProvider";
import { isMeaningfulSttText } from "./filterHallucinations";
import { createLiveTranslationQueue } from "./liveTranslationQueue";
import type { STTSegment, STTProvider } from "./types";
import { effectiveTranscriptionMode, type MeetingTranscriptionMode } from "./transcriptionMode";
/** The live preview is a convenience; the final pass transcribes everything.
 *  So when the model cannot keep up, the oldest waiting windows are dropped
 *  instead of letting an unbounded backlog (and its audio in memory) build up. */
const MAX_WAITING_CHUNKS = 3;
/** One window may take this long before the engine is considered stuck. */
const LIVE_CALL_TIMEOUT_MS = 90_000;
/** On End Meeting, how long a running window may delay the final pass. */
const CLOSE_GRACE_MS = 3_000;

function withTimeout<T>(work: Promise<T>, ms: number, label: string, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`${label} took longer than ${Math.round(ms / 1000)}s`));
    }, ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export type LiveSttStatus = "starting" | "listening" | "catching-up" | "unavailable";
export interface LiveSttSnapshot {
  status: LiveSttStatus;
  segments: STTSegment[];
  /** Approximate audio time that has been transcribed, in seconds. */
  processedUntilSec: number;
  /** Optional error or warning message */
  message?: string;
  /** Map of segment index to translated text */
  translations?: Record<number, string>;
}

export interface LiveTranscriptionOptions {
  language: string;
  mode?: MeetingTranscriptionMode;
  meetingId?: string;
  enableTranslation?: boolean;
  targetLanguage?: string;
}

export interface LiveTranscriptionHandle {
  enqueue: (blob: Blob, startTimeMs: number) => void;
  pause: () => void;
  resume: () => void;
  setTranslationOptions: (opts: { enabled: boolean; targetLanguage?: string }) => void;
  markResumed: (elapsedSec: number) => void;
  close: () => Promise<void>;
}
export function startLiveTranscription(
  onUpdate: (snapshot: LiveSttSnapshot) => void,
  optionsOrLang: string | LiveTranscriptionOptions,
): LiveTranscriptionHandle {
  const options: LiveTranscriptionOptions =
    typeof optionsOrLang === "string" ? { language: optionsOrLang } : optionsOrLang;

  const { language, meetingId, enableTranslation = false, targetLanguage = "Vietnamese" } = options;
  // Mobile devices are forced to the API ("fast"), never the local model.
  const mode = effectiveTranscriptionMode(options.mode ?? "low");

  let currentEnableTranslation = enableTranslation;
  let currentTargetLanguage = targetLanguage;

  let closed = false;
  let provider: STTProvider | null = null;
  let providerPromise: Promise<STTProvider> | null = null;
  let segments: STTSegment[] = [];
  // Translations per target language: switching A -> B -> A reuses A's.
  const translationsByLang = new Map<string, Record<number, string>>();
  const translationsFor = (lang: string): Record<number, string> => {
    let store = translationsByLang.get(lang);
    if (!store) {
      store = {};
      translationsByLang.set(lang, store);
    }
    return store;
  };
  let processedUntilSec = 0;
  let pendingCount = 0;
  let lastMessage: string | undefined;

  const publish = (status: LiveSttStatus, msg?: string) => {
    lastMessage = msg;
    onUpdate({
      status,
      segments: [...segments],
      processedUntilSec,
      message: lastMessage,
      translations: { ...translationsFor(currentTargetLanguage) },
    });
  };

  const getLocalProvider = async (): Promise<STTProvider> => {
    if (provider) return provider;
    if (!providerPromise) {
      providerPromise = (async () => {
        const preloaded = getPreloadedSttProviders();
        const next = preloaded?.whisper ?? new WorkerSTTProvider();
        await next.load();
        await next.setLanguage(language);
        provider = next;
        return next;
      })().catch((err) => {
        // Don't cache a rejected promise — a single failed load()/
        // setLanguage() call would otherwise permanently break live
        // transcription for the rest of THIS recording session (every
        // future enqueue() would fail the same way with no chance to
        // recover), instead of letting the next chunk retry.
        providerPromise = null;
        throw err;
      });
    }
    return providerPromise;
  };

  const translationQueue = createLiveTranslationQueue({
    getTranslations: translationsFor,
    isClosed: () => closed,
    isEnabled: () => currentEnableTranslation,
    getTargetLanguage: () => currentTargetLanguage,
    onChange: () => publish(pendingCount > 0 ? "catching-up" : "listening"),
    onUnavailable: (index, lang) => { translationsFor(lang)[index] = "—"; },
  });
  const transcribeWithFastApi = async (
    audio: Float32Array,
    sampleRate: number,
    startTimeMs: number,
  ): Promise<STTSegment[]> => {
    if (!meetingId) {
      throw new Error("meetingId is required for fast transcription mode");
    }
    const offsetSec = startTimeMs / 1000;
    const pcmData = encodeFloat32AsInt16Pcm(audio);

    const res = await fetch(`/api/meeting/${encodeURIComponent(meetingId)}/transcribe-fast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-sample-rate": String(sampleRate),
        "x-offset-sec": String(offsetSec),
        "x-stt-purpose": "live",
      },
      body: pcmData,
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const errMsg = body?.error || `Server fast transcribe error: ${res.status}`;
      console.warn("[meeting]", errMsg);
      lastMessage = errMsg;
      // Phones never run the heavy local model: loading it mid-meeting is what
      // freezes or crashes the tab. The final pass still covers this window.
      if (isMobileDevice()) return [];
      try {
        const local = await getLocalProvider();
        const localRes = await local.transcribe(audio, sampleRate);
        return localRes.segments.map((s) => ({
          start: s.start + offsetSec,
          end: s.end + offsetSec,
          text: s.text,
        }));
      } catch (localErr) {
        console.error("[meeting] Local STT fallback failed:", localErr);
        return [];
      }
    }

    const data = (await res.json()) as { segments?: STTSegment[] };
    return data.segments ?? [];
  };

  const waiting: { blob: Blob; startTimeMs: number }[] = [];
  let draining: Promise<void> | null = null;

  const processOne = async (blob: Blob, startTimeMs: number) => {
    publish("starting");
    try {
      const decoded = await decodeAudioTo16kMono(blob);
      if (closed) return;

      let newSegments: STTSegment[] = [];
      const offsetSec = startTimeMs / 1000;

      if (mode === "fast" && meetingId) {
        newSegments = await transcribeWithFastApi(decoded.audio, decoded.sampleRate, startTimeMs);
      } else {
        const activeProvider = await withTimeout(getLocalProvider(), LIVE_CALL_TIMEOUT_MS * 3, "Loading the speech model", () => {
          // A load that never finishes: start over with a fresh worker next time.
          provider = null;
          providerPromise = null;
          resetSttWorker("Loading the speech model timed out.");
        });
        const result = await withTimeout(activeProvider.transcribe(decoded.audio, decoded.sampleRate), LIVE_CALL_TIMEOUT_MS, "Live transcription", () => {
          // The worker cannot be interrupted, so replace it. The model is
          // reloaded from the browser cache on the next window.
          provider = null;
          providerPromise = null;
          resetSttWorker("Live transcription timed out.");
        });
        newSegments = result.segments.map((segment) => ({
          start: segment.start + offsetSec,
          end: segment.end + offsetSec,
          text: segment.text,
        }));
      }

      processedUntilSec = Math.max(processedUntilSec, offsetSec + decoded.audio.length / decoded.sampleRate);
      newSegments = newSegments.filter((s) => isMeaningfulSttText(s.text));
      if (newSegments.length === 0) {
        publish(waiting.length > 0 ? "catching-up" : "listening");
        return;
      }

      const startIndex = segments.length;
      segments.push(...newSegments);

      publish(waiting.length > 0 ? "catching-up" : "listening");

      if (meetingId) {
        void fetch(`/api/meeting/${encodeURIComponent(meetingId)}/live-transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segments: newSegments }),
        }).catch(() => undefined);
      }

      if (currentEnableTranslation) {
        translationQueue.enqueueMany(newSegments.map((segment, i) => ({
          index: startIndex + i,
          text: segment.text,
          lang: currentTargetLanguage,
        })));
      }
    } catch (err) {
      console.warn("[meeting] Live STT warning:", err instanceof Error ? err.message : String(err));
      publish("unavailable", err instanceof Error ? err.message : undefined);
    }
  };

  const drain = async () => {
    while (!closed) {
      const next = waiting.shift();
      if (!next) break;
      pendingCount = waiting.length;
      await processOne(next.blob, next.startTimeMs);
    }
    draining = null;
  };

  const enqueue = (blob: Blob, startTimeMs: number) => {
    if (closed) return;
    waiting.push({ blob, startTimeMs });
    let skipped = 0;
    while (waiting.length > MAX_WAITING_CHUNKS) {
      waiting.shift();
      skipped++;
    }
    pendingCount = waiting.length;
    if (skipped > 0) {
      publish("catching-up", "Live preview is behind and is skipping some audio. The final transcript will include everything.");
    } else if (pendingCount > 1) publish("catching-up");
    if (!draining) draining = drain();
  };

  publish("starting");

  return {
    enqueue,
    pause() { /* HTTP chunks are naturally paused by MediaRecorder. */ },
    resume() { /* HTTP chunks resume with the next recorder chunk. */ },
    setTranslationOptions(opts: { enabled: boolean; targetLanguage?: string }) {
      currentEnableTranslation = opts.enabled;
      if (opts.targetLanguage && opts.targetLanguage !== currentTargetLanguage) {
        currentTargetLanguage = opts.targetLanguage;
        // Requests already sent keep going and are stored under their own language.
        translationQueue.clearPending();
      }
      if (!currentEnableTranslation) {
        translationQueue.clear();
      } else {
        // Only segments without a translation are sent; failed ones ("—") retry.
        const store = translationsFor(currentTargetLanguage);
        for (const key of Object.keys(store)) {
          if (store[Number(key)] === "—") delete store[Number(key)];
        }
        translationQueue.enqueueMany(segments.map((segment, index) => ({
          index,
          text: segment.text,
          lang: currentTargetLanguage,
        })));
      }
      publish(pendingCount > 0 ? "catching-up" : "listening");
    },
    /** Called when live transcription is switched back on: audio recorded
     *  while it was off is not transcribed, so it must not count as lag. */
    markResumed(elapsedSec: number) {
      processedUntilSec = Math.max(processedUntilSec, elapsedSec);
      publish(pendingCount > 0 ? "catching-up" : "listening");
    },
    async close() {
      closed = true;
      waiting.length = 0;
      pendingCount = 0;
      translationQueue.close();
      const running = draining;
      if (!running) return;
      // A window still being transcribed must not hold up the final pass: give
      // it a moment, then replace the worker so nothing queues behind it.
      const finished = await Promise.race([running.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), CLOSE_GRACE_MS))]);
      if (!finished && !isMobileDevice() && mode !== "fast") {
        provider = null;
        providerPromise = null;
        resetSttWorker("Live transcription was closed.");
      }
    },
  };
}
