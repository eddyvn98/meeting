/**
 * lib/meeting/stt/chunkConstants.ts
 *
 * Shared by chunkedLocalTranscription.ts and chunkedServerTranscription.ts —
 * a long meeting is sliced into pieces this size regardless of which engine
 * ends up transcribing it, so both paths agree on one value instead of two
 * copies drifting apart.
 */
export const CHUNK_DURATION_SEC = 15 * 60;

/** The in-browser model gets short windows. One 15-minute call can run for
 *  half an hour on a CPU with no sign of life and cannot be interrupted, which
 *  left the Processing screen "working" for 90 minutes with no way out. At 60s
 *  a window finishes in a minute or two, so progress is visible and a stuck
 *  one is noticed within minutes. Whisper itself works in 30s windows, so this
 *  adds no new cut points of consequence. */
export const LOCAL_STT_WINDOW_SEC = 60;
/** Speaker embeddings only; clustering still runs once over all windows. */
export const LOCAL_DIARIZATION_WINDOW_SEC = 5 * 60;
