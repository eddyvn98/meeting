/**
 * lib/meeting/recorder/meetingRecorderApi.ts
 *
 * Backend API communication helpers for useMeetingRecorder.
 */

import { listChunkMetaForMeeting } from "./db";
import { emitMeetingsChanged } from "../meetingEvents";
import { isChunkAcknowledged } from "./uploadQueue";

/** How long the upload backlog may go without a single chunk being acknowledged before giving up. */
export const WAIT_FOR_UPLOADS_TIMEOUT_MS = 30_000;
/** Hard cap, so a slow-but-moving connection is never waited on forever. */
const WAIT_FOR_UPLOADS_MAX_MS = 10 * 60_000;
const WAIT_POLL_INTERVAL_MS = 500;

/** Resolves true once chunks 0..expectedChunkCount-1 have all been
 *  acknowledged by the server. `stallTimeoutMs` is a "no progress" limit, not
 *  a total one: it restarts each time another chunk gets through, so a long
 *  recording on a slow connection is not abandoned while it is still
 *  uploading. A chunk counts as done when either IndexedDB or this page
 *  session's own record says so, so a broken IndexedDB cannot block it. */
export async function waitForChunksUploaded(
  meetingId: string,
  expectedChunkCount: number,
  stallTimeoutMs: number,
): Promise<boolean> {
  const startedAt = Date.now();
  let lastProgressAt = startedAt;
  let lastDone = -1;
  while (Date.now() - startedAt < WAIT_FOR_UPLOADS_MAX_MS) {
    const metas = await listChunkMetaForMeeting(meetingId).catch(() => []);
    const uploadedInDb = new Set(metas.filter((m) => m.uploadState === "uploaded").map((m) => m.chunkIndex));
    let done = 0;
    for (let index = 0; index < expectedChunkCount; index++) {
      if (uploadedInDb.has(index) || isChunkAcknowledged(meetingId, index)) done++;
    }
    if (done === expectedChunkCount) return true;
    if (done > lastDone) {
      lastDone = done;
      lastProgressAt = Date.now();
    }
    if (Date.now() - lastProgressAt >= stallTimeoutMs) return false;
    await new Promise((r) => setTimeout(r, WAIT_POLL_INTERVAL_MS));
  }
  return false;
}

export async function createMeetingRecord(title: string, sttLanguage: string): Promise<string> {
  const res = await fetch("/api/meeting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, status: "UPLOADING", sttLanguage }),
  });
  if (!res.ok) throw new Error("Failed to create meeting");
  const data = (await res.json()) as { id: string };
  emitMeetingsChanged();
  return data.id;
}
