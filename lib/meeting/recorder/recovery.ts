/**
 * lib/meeting/recorder/recovery.ts
 *
 * Reload/crash recovery: was there a meeting still marked "recording" in
 * IndexedDB when the tab was closed/crashed? If so, surface it so the user
 * can resume uploading whatever chunks never made it to the server (capture
 * itself cannot resume — getDisplayMedia requires a fresh user gesture —
 * but every already-recorded chunk is still sitting in IndexedDB and can be
 * uploaded).
 */

import { clearLocalMeetingData, listChunkMetaForMeeting, listUnfinishedSessions } from "./db";
import { uploadChunkWithRetry } from "./uploadQueue";
import { isFinalizeInProgress, isRetryableFinalizeFailure } from "../audio/finalizeRetry";
import type { LocalChunkMeta, LocalMeetingSession } from "./types";

export interface RecoveryCandidate {
  session: LocalMeetingSession;
  chunks: LocalChunkMeta[];
  pendingUploadCount: number;
}

/** Asks the server whether this browser's local session still needs recovery.
 *  "recoverable": the meeting belongs to the signed-in user and is still
 *  UPLOADING. "done": the server already finalized it (or it failed), so the
 *  local backup is stale. "foreign": the meeting is not visible to the current
 *  user (another account used this browser, or it was deleted) and is left
 *  untouched. "failed": the server marked it FAILED; the local backup is kept
 *  and not offered, since finalizing a failed meeting does nothing. "unknown": the check itself failed (offline, server error). */
async function checkServerState(meetingId: string): Promise<"recoverable" | "done" | "failed" | "foreign" | "unknown"> {
  try {
    const response = await fetch(`/api/meeting/${encodeURIComponent(meetingId)}`, { cache: "no-store" });
    if (response.status === 404 || response.status === 403) return "foreign";
    if (!response.ok) return "unknown";
    const meeting = (await response.json()) as { status?: string; failureReason?: string | null; accessRole?: string };
    if (meeting.accessRole && meeting.accessRole !== "owner") return "foreign";
    if (isFinalizeInProgress({ status: meeting.status ?? "", failureReason: meeting.failureReason ?? null })) return "unknown";
    if (meeting.status === "UPLOADING" || isRetryableFinalizeFailure({ status: meeting.status ?? "", failureReason: meeting.failureReason ?? null })) return "recoverable";
    // A terminal FAILED (after a successful merge) cannot be finalized again, so
    // keep the local copy but do not offer it. READY/PROCESSING: the server has it.
    return meeting.status === "FAILED" ? "failed" : "done";
  } catch {
    return "unknown";
  }
}

/** Returns the most recent unfinished session that still needs recovery for
 *  the signed-in user, with its known local chunks. Sessions the server has
 *  already finalized are cleaned up locally instead of being offered again.
 *  Called once on the Home/Record screen mount. */
export async function findRecoveryCandidate(): Promise<RecoveryCandidate | null> {
  const sessions = (await listUnfinishedSessions()).sort((a, b) => b.startedAt - a.startedAt);
  for (const session of sessions) {
    const state = await checkServerState(session.meetingId);
    if (state === "done") {
      await clearLocalMeetingData(session.meetingId).catch(() => undefined);
      continue;
    }
    if (state !== "recoverable") continue;
    const chunks = await listChunkMetaForMeeting(session.meetingId);
    const pendingUploadCount = chunks.filter((c) => c.uploadState !== "uploaded").length;
    return { session, chunks, pendingUploadCount };
  }
  return null;
}

/** Uploads every not-yet-uploaded chunk (retrying with backoff — see
 *  uploadQueue.ts) then finalizes the meeting, exactly like a normal
 *  End Meeting would have. Works whether the session ended cleanly before
 *  the crash/reload (session.status === "ended", some chunks just never
 *  made it to the server) or was still "recording" when the tab died —
 *  capture itself cannot resume (getDisplayMedia needs a fresh user
 *  gesture), so either way the right move is: upload what we have, then
 *  treat the meeting as complete with that. Reports (uploaded, total)
 *  after every chunk so the caller can show progress; stops early if
 *  `signal` is aborted (caller cancelled) without finalizing. */
export async function resumeRecovery(
  candidate: RecoveryCandidate,
  onProgress: (uploaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const total = candidate.chunks.length;
  let uploaded = total - candidate.pendingUploadCount;
  onProgress(uploaded, total);

  for (const chunk of candidate.chunks) {
    if (chunk.uploadState === "uploaded") continue;
    if (signal?.aborted) return;
    await uploadChunkWithRetry(
      chunk,
      (updated) => {
        if (updated.uploadState === "uploaded") {
          uploaded++;
          onProgress(uploaded, total);
        }
      },
      signal,
    );
  }
  if (signal?.aborted) return;

  const finalizeResponse = await fetch(`/api/meeting/${candidate.session.meetingId}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedChunkCount: total }),
  });
  if (!finalizeResponse.ok) {
    if (finalizeResponse.status === 409) {
      let missingSequences: number[] = [];
      try {
        const body: unknown = await finalizeResponse.json();
        if (
          typeof body === "object" &&
          body !== null &&
          "missingSequences" in body &&
          Array.isArray(body.missingSequences)
        ) {
          missingSequences = body.missingSequences.filter((value): value is number => typeof value === "number");
        }
      } catch {
        // Keep the retry-oriented fallback when the server response is not JSON.
      }
      const missingDetail = missingSequences.length > 0 ? ` Missing chunks: ${missingSequences.join(", ")}.` : "";
      throw new Error(`Some audio chunks are still uploading. Try again.${missingDetail}`);
    }
    throw new Error(`The server could not finalize the recovered meeting (HTTP ${finalizeResponse.status}).`);
  }
}

/** Discards a recovery candidate the user chose not to resume — clears the
 *  local IndexedDB backup only; the meeting row on the server (if any
 *  chunk made it there before the crash) is left alone, still visible from
 *  Recent Meetings, still resumable later by re-opening it. */
export async function discardRecovery(candidate: RecoveryCandidate): Promise<void> {
  await clearLocalMeetingData(candidate.session.meetingId);
}
