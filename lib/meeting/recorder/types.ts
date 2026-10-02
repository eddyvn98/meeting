/**
 * lib/meeting/recorder/types.ts
 *
 * Local-only shapes for the client-side recording pipeline (capture,
 * chunking, IndexedDB backup, upload queue). Deliberately separate from
 * lib/meeting/types.ts (the server/API contract) — a LocalChunk lives in the
 * browser and carries a Blob + upload bookkeeping the server never sees.
 */

import type { RefObject } from "react";
import type { LiveSttStatus } from "../stt/liveTranscription";
import type { STTSegment } from "../stt/types";
import type { MeetingTranscriptionMode } from "../stt/transcriptionMode";

export type CaptureSource = "display" | "microphone";

/** Why capture couldn't start, or why a stream that *did* start is unusable.
 *  Surfaced verbatim in the Recording Screen — never silently treated as a
 *  success, per the spec's "detect silent/missing track" requirement. */
export type CaptureErrorReason =
  | "permission-denied"
  | "not-supported"
  | "no-audio-track"
  | "silent-audio"
  | "audio-ended"
  | "unknown";

export interface CaptureError {
  reason: CaptureErrorReason;
  message: string;
}

export type RecorderStatus =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "stopping"
  /** Every chunk is queued; waiting (bounded — see meetingRecorderApi.ts's
   *  WAIT_FOR_UPLOADS_TIMEOUT_MS) for straggling uploads to finish before
   *  calling finalize. */
  | "finalizing"
  /** Audio upload is finalized; keep the live transcript view mounted while
   *  server-side meeting processing continues. */
  | "processing"
  | "stopped"
  /** The user discarded the recording; nothing was kept. */
  | "cancelled"
  | "error";

/** One recorder chunk's local lifecycle (~4s in fast mode, ~10s in low mode).
 * `localState` tracks the IndexedDB write
 *  itself; `uploadState` tracks the server ACK independently — per the
 *  spec's critical rule, a chunk reaching "uploaded" is NOT deleted locally,
 *  it just stops being retried. */
export type ChunkLocalState = "recording" | "stored";
export type ChunkUploadState = "pending" | "uploading" | "uploaded" | "failed";

export interface LocalChunkMeta {
  /** IndexedDB primary key: `${meetingId}:${chunkIndex}`. */
  id: string;
  meetingId: string;
  chunkIndex: number;
  startTimeMs: number;
  endTimeMs: number;
  mimeType: string;
  sizeBytes: number;
  localState: ChunkLocalState;
  uploadState: ChunkUploadState;
  uploadAttempts: number;
  createdAt: number;
}

/** Stored alongside LocalChunkMeta but in its own object store — see
 *  db.ts. Kept separate so listing metadata (for the UI chunk-count) never
 *  has to deserialize Blobs. */
export interface LocalChunkBlob {
  id: string;
  blob: Blob;
}

/** One IndexedDB row per in-progress or finished local recording session,
 *  used purely for crash/reload recovery — "was there an unfinished
 *  meeting?" */
export interface LocalMeetingSession {
  meetingId: string;
  title: string;
  startedAt: number;
  endedAt: number | null;
  /** "recording" until End Meeting finalizes the last chunk and every chunk
   *  known at that time is uploaded (or upload has been handed off to the
   *  retry queue) — see useMeetingRecorder's endMeeting(). */
  status: "recording" | "ended";
  chunkCount: number;
  marks: number[];
}

export interface MeetingRecorderState {
  status: RecorderStatus;
  error: CaptureError | null;
  meetingId: string | null;
  elapsedMs: number;
  chunkCount: number;
  uploadedCount: number;
  marks: number[];
  liveSttStatus: LiveSttStatus;
  liveTranscript: STTSegment[];
  liveTranslations: Record<number, string>;
  liveProcessedUntilSec: number;
  liveMessage?: string;
  transcriptionMode: MeetingTranscriptionMode;
  isPaused: boolean;
  liveTranscriptEnabled: boolean;
  liveTranslationEnabled: boolean;
  targetTranslateLanguage: string;
  streamRef: RefObject<MediaStream | null>;
}

export interface MeetingRecorderActions {
  start: (title: string, source?: CaptureSource) => Promise<void>;
  markImportant: () => void;
  pause: () => void;
  resume: () => void;
  endMeeting: () => Promise<void>;
  cancelRecording: () => Promise<void>;
  setTranscriptionMode: (mode: MeetingTranscriptionMode) => void;
  setLiveTranscriptEnabled: (enabled: boolean) => void;
  setLiveTranslationEnabled: (enabled: boolean) => void;
  setTargetTranslateLanguage: (lang: string) => void;
}
