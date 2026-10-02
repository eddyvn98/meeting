/**
 * lib/meeting/recorder/chunkController.ts
 *
 * Splits a live MediaStream into 10s (low mode) or 4s (fast mode) self-contained chunks. Deliberately
 * starts a *new* MediaRecorder every interval rather than using one
 * recorder's `timeslice` option: with most codecs (webm/opus included) the
 * slices `ondataavailable` hands back under `timeslice` are fragments of one
 * continuous container, not independently decodable files — rotating the
 * recorder guarantees each chunk blob is a complete, standalone file the
 * server (and any offline STT step) can open on its own.
 */

// 10s keeps the live-caption preview responsive on CPU-only browsers running Whisper WASM.
// 4s keeps the paid OpenRouter transcription path responsive while preserving
// enough audio context for each standalone request.
export const CHUNK_DURATION_LOW_MS = 10_000;
export const CHUNK_DURATION_FAST_MS = 4_000;
const CANDIDATE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
];

export function pickSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const type of CANDIDATE_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

export interface FinishedChunk {
  chunkIndex: number;
  /** Timeline timestamps with paused wall-clock time removed. */
  startTimeMs: number;
  endTimeMs: number;
  mimeType: string;
  blob: Blob;
}

export interface ChunkControllerHandle {
  stop: () => Promise<FinishedChunk | null>;
  pause: () => boolean;
  resume: () => boolean;
  /** Finishes the chunk in progress right now (instead of at the next tick) so
   *  its audio is saved before the page may be frozen or killed. */
  flushNow: () => void;
}

/** Starts rotating recorders against `stream`, calling `onChunk` with each
 *  completed chunk as soon as it's finalized. `stop()` finalizes the current
 *  in-progress chunk early (used by "Mark important"/End Meeting so the
 *  last partial segment isn't lost) and resolves with it.
 *
 *  Rotation is gap-free: the next recorder is started BEFORE the current one
 *  is stopped, so the stream is never unrecorded. (Stopping first and starting
 *  after the finished chunk is delivered left a hole of tens to hundreds of
 *  milliseconds every chunk, cutting a word at each boundary.) The two overlap
 *  by the few milliseconds a recorder takes to start, which only repeats a
 *  fraction of a syllable and is harmless to transcription. */
export function startChunking(
  stream: MediaStream,
  onChunk: (chunk: FinishedChunk) => void,
  mimeType: string,
  chunkDurationMs: number = CHUNK_DURATION_LOW_MS,
  onTrackEnded?: () => void,
): ChunkControllerHandle {
  // Index of the next chunk that actually has audio. Assigned when a chunk is
  // finished, not when its recorder starts: a recorder that yields no data
  // (muted or ended input) must not leave a hole in the sequence, because the
  // server refuses to finalize a recording whose sequences are not 0..N-1.
  let nextChunkIndex = 0;
  interface ActiveRecorder {
    recorder: MediaRecorder;
    /** Wall-clock start, used to time the next rotation. */
    startMs: number;
    /** Timeline start with paused time removed. */
    recordedStartMs: number;
    finished?: Promise<FinishedChunk | null>;
  }
  let totalPausedMs = 0;
  let accumulatedPauseMs = 0;
  let pauseStartedMs = 0;
  let rotateTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let paused = false;
  let rotating = false;
  // The rotation in flight, so stop() can wait for the chunk it is delivering.
  let rotation: Promise<void> | null = null;
  const audioTracks = stream.getAudioTracks();
  const trackEnded = () => { if (!stopped) onTrackEnded?.(); };
  const removeTrackListeners = () => audioTracks.forEach((track) => track.removeEventListener("ended", trackEnded));
  audioTracks.forEach((track) => track.addEventListener("ended", trackEnded));

  function begin(): ActiveRecorder {
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder.start();
    const startMs = Date.now();
    return { recorder, startMs, recordedStartMs: startMs - totalPausedMs };
  }

  /** Stops one recorder and resolves with its audio (null when it recorded none). */
  function finish(active: ActiveRecorder): Promise<FinishedChunk | null> {
    if (active.finished) return active.finished;
    const { recorder } = active;
    if (recorder.state === "inactive") return (active.finished = Promise.resolve(null));
    active.finished = new Promise<FinishedChunk | null>((resolve) => {
      const parts: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) parts.push(e.data);
      };
      recorder.onstop = () => {
        if (parts.length === 0) {
          resolve(null);
          return;
        }
        const endNowMs = Date.now();
        const actualMimeType = recorder.mimeType || mimeType || "audio/webm";
        resolve({
          chunkIndex: nextChunkIndex++,
          startTimeMs: active.recordedStartMs,
          endTimeMs: endNowMs - totalPausedMs - (paused ? Math.max(0, endNowMs - pauseStartedMs) : 0),
          mimeType: actualMimeType,
          blob: new Blob(parts, { type: actualMimeType }),
        });
      };
      recorder.stop();
    });
    return active.finished;
  }

  let active = begin();

  function scheduleRotate(delayMs = chunkDurationMs) {
    if (rotateTimer) clearTimeout(rotateTimer);
    rotateTimer = setTimeout(() => {
      void rotate();
    }, Math.max(0, delayMs));
  }

  function rotate(): Promise<void> {
    // The timer and flushNow() can both ask for a rotation; a second one while
    // the first is in flight would start two extra recorders.
    if (stopped || paused || rotating) return rotation ?? Promise.resolve();
    rotating = true;
    const finishing = active;
    active = begin();
    accumulatedPauseMs = 0;
    scheduleRotate();
    rotation = finish(finishing)
      .then((chunk) => {
        // Delivered even if stop() was called meanwhile: stop() waits for this.
        if (chunk) onChunk(chunk);
      })
      .finally(() => {
        rotating = false;
        rotation = null;
      });
    return rotation;
  }

  scheduleRotate();

  return {
    pause() {
      if (stopped || paused || active.recorder.state !== "recording") return false;
      paused = true;
      pauseStartedMs = Date.now();
      if (rotateTimer) clearTimeout(rotateTimer);
      active.recorder.pause();
      return true;
    },
    resume() {
      if (stopped || !paused) return false;
      paused = false;
      const pauseDurationMs = Math.max(0, Date.now() - pauseStartedMs);
      accumulatedPauseMs += pauseDurationMs;
      totalPausedMs += pauseDurationMs;
      if (active.recorder.state === "paused") active.recorder.resume();
      const elapsedMs = Date.now() - active.startMs - accumulatedPauseMs;
      scheduleRotate(chunkDurationMs - elapsedMs);
      return true;
    },
    flushNow() {
      void rotate();
    },
    async stop() {
      stopped = true;
      removeTrackListeners();
      if (rotateTimer) clearTimeout(rotateTimer);
      // Let a chunk that is mid-delivery land first so indexes stay in order.
      await rotation;
      return finish(active);
    },
  };
}
