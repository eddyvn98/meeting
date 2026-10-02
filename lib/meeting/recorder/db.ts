/**
 * lib/meeting/recorder/db.ts
 *
 * Thin IndexedDB wrapper for local chunk backup + crash recovery. No
 * external dependency (idb, dexie, ...) — the schema is tiny (3 stores) and
 * this keeps the recording pipeline dependency-free.
 *
 * Three object stores:
 * - "sessions": one LocalMeetingSession per meeting (recovery bookkeeping).
 * - "chunkMeta": one LocalChunkMeta per chunk (cheap to list/scan).
 * - "chunkBlobs": one LocalChunkBlob per chunk (the actual audio bytes),
 *   kept separate so scanning metadata for the UI never touches Blobs.
 */

import type { LocalChunkBlob, LocalChunkMeta, LocalMeetingSession } from "./types";

const DB_NAME = "meeting-recorder";
const DB_VERSION = 1;
const STORE_SESSIONS = "sessions";
const STORE_CHUNK_META = "chunkMeta";
const STORE_CHUNK_BLOBS = "chunkBlobs";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available in this environment"));
  }
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          db.createObjectStore(STORE_SESSIONS, { keyPath: "meetingId" });
        }
        if (!db.objectStoreNames.contains(STORE_CHUNK_META)) {
          const store = db.createObjectStore(STORE_CHUNK_META, { keyPath: "id" });
          store.createIndex("meetingId", "meetingId", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_CHUNK_BLOBS)) {
          db.createObjectStore(STORE_CHUNK_BLOBS, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Failed to open meeting-recorder DB"));
    }).catch((err) => {
      // Don't cache a rejected promise — a single transient open failure
      // (quota, a private-mode edge case, etc.) would otherwise permanently
      // disable all local chunk/session persistence for the rest of the
      // page session, since every later call would just re-reject with this
      // same stale error instead of retrying.
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

function runTx<T>(
  storeNames: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeNames, mode);
        const result = fn(tx);
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
        if (result instanceof Promise) {
          result.then(resolve, reject);
          return;
        }
        result.onsuccess = () => resolve(result.result);
        result.onerror = () => reject(result.error ?? new Error("IndexedDB request failed"));
      }),
  );
}

export async function putSession(session: LocalMeetingSession): Promise<void> {
  await runTx([STORE_SESSIONS], "readwrite", (tx) => tx.objectStore(STORE_SESSIONS).put(session));
}

export async function getSession(meetingId: string): Promise<LocalMeetingSession | undefined> {
  return runTx([STORE_SESSIONS], "readonly", (tx) => tx.objectStore(STORE_SESSIONS).get(meetingId));
}

/** All sessions still present in local storage — used by recovery.ts to
 *  detect an unfinished meeting after a reload/crash. A session row is only
 *  ever deleted by clearLocalMeetingData(), which runs once the meeting
 *  reaches READY on the Processing screen — so a row still here means the
 *  meeting isn't durably done yet, whether the crash happened mid-recording
 *  (status "recording") or after "End Meeting" but before finalize/upload
 *  actually completed (status "ended"). Filtering this to "recording" only
 *  used to make a crash in that second window permanently unrecoverable. */
export async function listUnfinishedSessions(): Promise<LocalMeetingSession[]> {
  return runTx<LocalMeetingSession[]>([STORE_SESSIONS], "readonly", (tx) =>
    tx.objectStore(STORE_SESSIONS).getAll(),
  );
}

export async function putChunkMeta(meta: LocalChunkMeta): Promise<void> {
  await runTx([STORE_CHUNK_META], "readwrite", (tx) => tx.objectStore(STORE_CHUNK_META).put(meta));
}

export async function putChunkBlob(blob: LocalChunkBlob): Promise<void> {
  await runTx([STORE_CHUNK_BLOBS], "readwrite", (tx) => tx.objectStore(STORE_CHUNK_BLOBS).put(blob));
}

export async function getChunkBlob(id: string): Promise<Blob | undefined> {
  const row = await runTx<LocalChunkBlob | undefined>([STORE_CHUNK_BLOBS], "readonly", (tx) =>
    tx.objectStore(STORE_CHUNK_BLOBS).get(id),
  );
  return row?.blob;
}

/** All chunk metadata for one meeting, ordered by chunkIndex. Used both by
 *  the live recording screen (upload-count UI) and by recovery.ts (listing
 *  what's left to upload after a reload). */
export async function listChunkMetaForMeeting(meetingId: string): Promise<LocalChunkMeta[]> {
  const all = await runTx<LocalChunkMeta[]>([STORE_CHUNK_META], "readonly", (tx) =>
    tx.objectStore(STORE_CHUNK_META).index("meetingId").getAll(meetingId),
  );
  return all.sort((a, b) => a.chunkIndex - b.chunkIndex);
}

/** Deletes every local chunk (meta + blob) and the session row for one
 *  meeting — called once the meeting reaches READY (see the Processing
 *  screen), at which point the server already has a durable copy of
 *  everything (chunks/route.ts, finalize/route.ts's merge) and the local
 *  IndexedDB backup has done its job. Chunks are deliberately NOT deleted
 *  any earlier than that (e.g. right after each individual chunk's server
 *  ACK) — the whole point of the local backup is to survive a crash before
 *  the meeting is known-durable, and per-chunk ACKs don't guarantee the
 *  meeting as a whole will finish processing. Also used to discard an
 *  abandoned recovery candidate (recovery.ts) the user chose not to resume. */
export async function clearLocalMeetingData(meetingId: string): Promise<void> {
  const metas = await listChunkMetaForMeeting(meetingId);
  for (const meta of metas) {
    await runTx([STORE_CHUNK_META], "readwrite", (tx) => tx.objectStore(STORE_CHUNK_META).delete(meta.id));
    await runTx([STORE_CHUNK_BLOBS], "readwrite", (tx) => tx.objectStore(STORE_CHUNK_BLOBS).delete(meta.id));
  }
  await runTx([STORE_SESSIONS], "readwrite", (tx) => tx.objectStore(STORE_SESSIONS).delete(meetingId));
}
