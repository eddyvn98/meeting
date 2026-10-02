"use client";

/**
 * lib/meeting/stt/preloadStt.ts
 *
 * Warms both client-side STT models (Whisper + diarization — see
 * providerFactory.ts) so the Processing screen's real work
 * (runLocalMeetingProcessing.ts) doesn't eat the download+init cost the first
 * time a user finishes a recording. Nothing calls this on page load: it runs
 * in the background only when local ("low") transcription is about to be
 * used (see warmSttModelsInBackground), and every consumer also loads the
 * models on demand if this never ran. Loads them through
 * the Worker-backed proxies (sttWorkerClient.ts) rather than the raw
 * Local*Provider classes directly, so this preload — and every later real
 * transcription reusing these same warm instances — runs in the dedicated
 * Worker (sttWorker.ts) instead of blocking this tab's main thread. A
 * module-level flag tracks whether models finished loading in memory.
 */

import { WorkerSTTProvider, WorkerDiarizationProvider, onWorkerReset } from "./sttWorkerClient";
import { isMobileDevice } from "./mobileDevice";

let preloaded = false;
let sharedWhisper: WorkerSTTProvider | null = null;
let sharedDiarization: WorkerDiarizationProvider | null = null;

// If the shared worker dies (see sttWorkerClient.ts), the models it had
// loaded die with it — a next call transparently spins up a fresh, unloaded
// worker. Without this, getPreloadedSttProviders() would keep handing out
// these now-dead instances as "preloaded", and the first real transcribe()
// call after the crash would silently stall while the model re-downloads/
// re-initializes mid-meeting-processing with no progress shown, or fail
// outright if the underlying error persists.
onWorkerReset(() => {
  preloaded = false;
  sharedWhisper = null;
  sharedDiarization = null;
});

export function wasSttPreloaded(): boolean {
  return preloaded;
}

/** The same provider instances this warms, so the Processing screen's own
 *  getSTTProviders() call (providerFactory.ts) reuses the already-loaded
 *  model instead of constructing (and re-downloading into) a fresh one. */
export function getPreloadedSttProviders(): { whisper: WorkerSTTProvider; diarization: WorkerDiarizationProvider } | null {
  if (!preloaded || !sharedWhisper || !sharedDiarization) return null;
  return { whisper: sharedWhisper, diarization: sharedDiarization };
}

/** Weighted 0-100 across both models (Whisper is the larger download).
 *  Throws on failure — the caller decides how to degrade. */
export async function preloadSttModels(onProgress: (pct: number, label: string) => void): Promise<void> {
  const whisper = new WorkerSTTProvider();
  const diarization = new WorkerDiarizationProvider();

  onProgress(0, "Loading speech-to-text model…");
  await whisper.load((pct) => onProgress(pct * 0.7, "Loading speech-to-text model…"));

  onProgress(70, "Loading speaker-detection model…");
  await diarization.load((pct) => onProgress(70 + pct * 0.3, "Loading speaker-detection model…"));

  sharedWhisper = whisper;
  sharedDiarization = diarization;
  preloaded = true;
  onProgress(100, "Ready");
}

let warming: Promise<void> | null = null;

/** Fire-and-forget, non-blocking warm-up for local ("low") transcription.
 *  Safe to call repeatedly: it is a no-op while already warm or in flight, and
 *  a failure is only logged — real transcription loads the models itself (or
 *  falls back to the server tier), so this never blocks or breaks anything. */
export function warmSttModelsInBackground(): void {
  // Phones never run the local models, so there is nothing to warm.
  if (isMobileDevice() || preloaded || warming) return;
  warming = preloadSttModels(() => {})
    .catch((err) => console.warn("[meeting] Background STT warm-up failed:", err instanceof Error ? err.message : String(err)))
    .finally(() => {
      warming = null;
    });
}
