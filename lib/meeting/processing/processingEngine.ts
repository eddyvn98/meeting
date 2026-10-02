/**
 * lib/meeting/processing/processingEngine.ts
 *
 * Decides which engine runs the FINAL transcription + speaker detection once
 * a meeting has been finalized (after "End meeting", or after an upload):
 * - "api": the paid transcription API does the text (speakers are then
 *   detected with our own models, see runLocalMeetingProcessing.ts).
 * - "server": our own server (Whisper + server diarization), free.
 * - "auto": the free in-browser path on desktop (local model, with the
 *   existing server fallback for a load/inference failure).
 *
 * The chosen mode decides on every device: fast (paid) -> "api" for the final
 * pass too, low -> free (our server on a phone, the browser on desktop).
 */

import { isMobileDevice, type MeetingTranscriptionMode } from "@/lib/meeting/stt/transcriptionMode";

export type ProcessingEngine = "api" | "server" | "auto";

export function resolveProcessingEngine(mode: MeetingTranscriptionMode): ProcessingEngine {
  if (mode === "fast") return "api";
  return freeProcessingEngine();
}

/** The free engine: also what is offered when the paid API fails. */
export function freeProcessingEngine(): ProcessingEngine {
  return isMobileDevice() ? "server" : "auto";
}
