/**
 * lib/meeting/recorder/fullRecorder.ts
 *
 * A second, CONTINUOUS MediaRecorder that runs next to the chunk recorders for
 * the whole meeting. The chunks feed live transcription and are the fallback
 * and crash backup; this one produces the recording people actually listen to:
 * one stream, so there are no joins between pieces and no dropouts (the
 * re-encoded concatenation of separately-encoded chunks can click or cut out at
 * every boundary). It is uploaded in one piece at End Meeting.
 *
 * Data is collected in memory in short slices: a long meeting at speech
 * bitrates is tens of megabytes. If the tab dies, the chunks in IndexedDB are
 * still there, so the continuous copy is a quality upgrade, not the only copy.
 */

const SLICE_MS = 5_000;
const UPLOAD_ATTEMPTS = 3;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

export interface FullRecorderHandle {
  pause: () => void;
  resume: () => void;
  /** Stops and resolves with the whole recording, or null if nothing was recorded. */
  stop: () => Promise<Blob | null>;
  /** Stops and throws everything away (cancelled meeting). */
  discard: () => void;
}

/** Returns null when the browser cannot run this recorder; recording then
 *  simply continues on the chunks alone. */
export function startFullRecorder(stream: MediaStream, mimeType: string): FullRecorderHandle | null {
  if (typeof MediaRecorder === "undefined") return null;
  let recorder: MediaRecorder;
  try {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const parts: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) parts.push(event.data);
    };
    recorder.start(SLICE_MS);
    let result: Promise<Blob | null> | null = null;
    let discarded = false;

    return {
      pause() {
        if (recorder.state === "recording") recorder.pause();
      },
      resume() {
        if (recorder.state === "paused") recorder.resume();
      },
      stop() {
        if (result) return result;
        result = new Promise<Blob | null>((resolve) => {
          if (recorder.state === "inactive") {
            resolve(parts.length > 0 && !discarded ? new Blob(parts, { type: recorder.mimeType || mimeType }) : null);
            return;
          }
          recorder.onstop = () => resolve(parts.length > 0 && !discarded ? new Blob(parts, { type: recorder.mimeType || mimeType || "audio/webm" }) : null);
          recorder.stop();
        });
        return result;
      },
      discard() {
        discarded = true;
        parts.length = 0;
        if (recorder.state !== "inactive") recorder.stop();
      },
    };
  } catch {
    return null;
  }
}

/** Uploads the continuous recording. Resolves true once the server has it;
 *  false (never throws) after a few tries, in which case the chunks are used. */
export async function uploadFullAudio(meetingId: string, blob: Blob): Promise<boolean> {
  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt++) {
    try {
      const form = new FormData();
      form.append("file", blob, "full");
      const res = await fetch(`/api/meeting/${encodeURIComponent(meetingId)}/full-audio`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      if (res.ok) return true;
      // The meeting is closed, the file is rejected: another try cannot help.
      if (res.status === 409 || res.status === 413 || res.status === 400 || res.status === 404) return false;
    } catch {
      // Network loss or timeout: try again.
    }
    await new Promise((r) => setTimeout(r, 1_000 * 2 ** attempt));
  }
  return false;
}
