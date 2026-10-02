/**
 * lib/meeting/stt/sttWorker.ts
 *
 * Runs LocalWhisperProvider / LocalDiarizationProvider inside a dedicated
 * Web Worker instead of the tab's main thread. @huggingface/transformers'
 * WASM inference is synchronous, CPU-bound JS execution with no internal
 * yielding back to the browser — calling it from the main thread (the
 * original design) blocks all UI updates, event handling, and even the
 * "page is still alive" heartbeat the browser uses to decide whether to
 * show its own "Page Unresponsive" dialog, confirmed live on a real
 * multi-minute local transcription. Running it in a Worker keeps the tab's
 * main thread free the whole time; sttWorkerClient.ts is the main-thread
 * proxy that talks to this file over postMessage.
 *
 * Not built as a class instance sent over the wire — Worker communication
 * only carries plain (structured-cloneable) data, so this owns the actual
 * LocalWhisperProvider/LocalDiarizationProvider instances itself and
 * exposes their methods as a small message-type switch instead.
 */

import { LocalWhisperProvider } from "./localWhisperProvider";
import { LocalDiarizationProvider } from "./localDiarizationProvider";

interface IncomingMessage {
  id: number;
  type: "loadWhisper" | "loadDiarization" | "transcribe" | "diarize" | "extractEmbeddingSpans" | "setLanguage";
  payload: unknown;
}

// `self` is typed against the "dom" lib project-wide (tsconfig.json can't
// mix in "webworker" without conflicting with every other file) — this
// narrow shape is all this file actually needs from the real
// DedicatedWorkerGlobalScope, cast once here instead of fighting the
// ambient global's DOM-window type everywhere below.
interface WorkerGlobal {
  postMessage(message: unknown): void;
  onmessage: ((ev: MessageEvent<IncomingMessage>) => void) | null;
}
const ctx = self as unknown as WorkerGlobal;

let whisper: LocalWhisperProvider | null = null;
let diarization: LocalDiarizationProvider | null = null;

function getWhisper(): LocalWhisperProvider {
  if (!whisper) whisper = new LocalWhisperProvider();
  return whisper;
}
function getDiarization(): LocalDiarizationProvider {
  if (!diarization) diarization = new LocalDiarizationProvider();
  return diarization;
}

ctx.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  try {
    switch (type) {
      case "loadWhisper": {
        await getWhisper().load((pct) => ctx.postMessage({ id, kind: "progress", payload: { pct } }));
        ctx.postMessage({ id, kind: "done", payload: getWhisper().getRuntimeInfo() });
        break;
      }
      case "setLanguage": {
        const { language } = payload as { language: string };
        getWhisper().setLanguage(language);
        ctx.postMessage({ id, kind: "done", payload: undefined });
        break;
      }
      case "loadDiarization": {
        await getDiarization().load((pct) => ctx.postMessage({ id, kind: "progress", payload: { pct } }));
        ctx.postMessage({ id, kind: "done", payload: undefined });
        break;
      }
      case "transcribe": {
        const { audio, sampleRate } = payload as { audio: Float32Array; sampleRate: number };
        const result = await getWhisper().transcribe(audio, sampleRate);
        ctx.postMessage({ id, kind: "done", payload: result });
        break;
      }
      case "diarize": {
        const { audio, sampleRate } = payload as { audio: Float32Array; sampleRate: number };
        const result = await getDiarization().diarize(audio, sampleRate);
        ctx.postMessage({ id, kind: "done", payload: result });
        break;
      }
      case "extractEmbeddingSpans": {
        const { audio, sampleRate, timeOffsetSec } = payload as {
          audio: Float32Array;
          sampleRate: number;
          timeOffsetSec: number;
        };
        const spans = await getDiarization().extractEmbeddingSpans(audio, sampleRate, timeOffsetSec);
        ctx.postMessage({ id, kind: "done", payload: spans });
        break;
      }
      default:
        ctx.postMessage({ id, kind: "error", payload: { message: `Unknown message type: ${String(type)}` } });
    }
  } catch (err) {
    ctx.postMessage({ id, kind: "error", payload: { message: err instanceof Error ? err.message : String(err) } });
  }
};
