/**
 * lib/meeting/audio/finalizeRetry.ts
 *
 * A finalize that fails on the server (merge, database) marks the meeting
 * FAILED with a reason that starts with FINALIZE_FAILURE_PREFIX. Every chunk is
 * still on disk and in the browser at that point, so such a meeting is NOT
 * terminal: it can be finalized again, still accepts chunk uploads, and its
 * audio is never swept. Any other FAILED meeting (for example a processing
 * failure after a successful merge) is terminal as before. Pure, so the
 * server routes, the sweep and the browser recovery all share one rule.
 */

export const FINALIZE_FAILURE_PREFIX = "Finalize failed (your audio is saved, finalize again): ";

export function isRetryableFinalizeFailure(meeting: { status: string; failureReason: string | null }): boolean {
  return meeting.status === "FAILED" && Boolean(meeting.failureReason?.startsWith(FINALIZE_FAILURE_PREFIX));
}

/** True while the meeting may still receive audio chunks and be finalized. */
export function acceptsAudio(meeting: { status: string; failureReason: string | null }): boolean {
  return meeting.status === "UPLOADING" || isRetryableFinalizeFailure(meeting);
}
