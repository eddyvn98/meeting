/**
 * lib/meeting/recorder/uploadQueue.ts
 *
 * Uploads one local chunk to POST /api/meeting/[meetingId]/chunks, retrying
 * with backoff on network loss. The chunk's Blob is never removed from
 * IndexedDB here regardless of outcome — db.ts has no deleteChunk() at all,
 * per the spec's local-retention rule (chunks stay until local STT/
 * diarization has consumed them, a later agent's concern). This module only
 * updates `uploadState` so the UI/recovery flow knows what's still pending.
 */

import { getChunkBlob, putChunkMeta } from "./db";
import type { LocalChunkMeta } from "./types";

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

function backoffFor(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
}

/** Chunks the server has acknowledged in this page session, per meeting. Kept
 *  in memory as well as in IndexedDB so "everything is uploaded" can still be
 *  answered when IndexedDB itself is failing (full disk, private mode). */
const acknowledged = new Map<string, Set<number>>();

export function isChunkAcknowledged(meetingId: string, chunkIndex: number): boolean {
  return acknowledged.get(meetingId)?.has(chunkIndex) ?? false;
}

function acknowledge(meetingId: string, chunkIndex: number): void {
  const set = acknowledged.get(meetingId) ?? new Set<number>();
  set.add(chunkIndex);
  acknowledged.set(meetingId, set);
}

/** A response that retrying cannot fix: the meeting is gone or closed, or the
 *  chunk itself is rejected. Anything else (network loss, 5xx, an expired
 *  session) is retried. */
export class PermanentUploadError extends Error {
  constructor(readonly status: number) {
    super(`The server rejected this audio chunk (HTTP ${status}).`);
  }
}

const PERMANENT_STATUSES = new Set([400, 404, 409, 413]);

async function uploadOnce(meta: LocalChunkMeta, blobOverride: Blob | undefined, signal?: AbortSignal): Promise<boolean> {
  const blob = blobOverride ?? (await getChunkBlob(meta.id).catch(() => undefined));
  if (!blob) return false;

  const form = new FormData();
  form.append("file", blob, `${meta.chunkIndex}.webm`);
  form.append("sequence", String(meta.chunkIndex));
  form.append("durationSec", String(Math.max(0, Math.round((meta.endTimeMs - meta.startTimeMs) / 1000))));
  form.append("sizeBytes", String(meta.sizeBytes));

  try {
    const res = await fetch(`/api/meeting/${meta.meetingId}/chunks`, { method: "POST", body: form, signal });
    if (!res.ok && PERMANENT_STATUSES.has(res.status)) throw new PermanentUploadError(res.status);
    return res.ok;
  } catch (error) {
    if (error instanceof PermanentUploadError) throw error;
    // Network loss / offline / aborted — caller retries (or stops, if aborted).
    return false;
  }
}

/** Uploads one chunk, retrying with backoff until it succeeds or `signal`
 *  is aborted (used to stop retrying if the whole recording session is torn
 *  down). Persists `uploadState`/`uploadAttempts` to IndexedDB after every
 *  attempt so a reload can resume from the last known state via
 *  recovery.ts.
 *
 *  `blobOverride` is the chunk's audio held in memory. It is passed when the
 *  chunk could not be written to IndexedDB, so the upload still happens and
 *  the bookkeeping writes below are allowed to fail without losing it.
 *  Throws PermanentUploadError when retrying cannot help. */
export async function uploadChunkWithRetry(
  meta: LocalChunkMeta,
  onUpdate: (meta: LocalChunkMeta) => void,
  signal?: AbortSignal,
  blobOverride?: Blob,
): Promise<void> {
  const save = (value: LocalChunkMeta) => (blobOverride ? putChunkMeta(value).catch(() => undefined) : putChunkMeta(value));
  let current: LocalChunkMeta = { ...meta, uploadState: "uploading" };
  await save(current);
  onUpdate(current);

  while (!signal?.aborted) {
    let ok: boolean;
    try {
      ok = await uploadOnce(current, blobOverride, signal);
    } catch (error) {
      current = { ...current, uploadState: "failed", uploadAttempts: current.uploadAttempts + 1 };
      await save(current);
      onUpdate(current);
      throw error;
    }
    if (ok) {
      acknowledge(current.meetingId, current.chunkIndex);
      current = { ...current, uploadState: "uploaded" };
      await save(current);
      onUpdate(current);
      return;
    }
    current = { ...current, uploadState: "failed", uploadAttempts: current.uploadAttempts + 1 };
    await save(current);
    onUpdate(current);
    await new Promise((r) => setTimeout(r, backoffFor(current.uploadAttempts)));
    current = { ...current, uploadState: "uploading" };
  }
}
