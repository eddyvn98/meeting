/**
 * lib/meeting/recorder/fileUploadPipeline.ts
 *
 * "Upload Recording" flow: an existing audio/video file, handed to the same
 * chunk/upload API the live recorder uses, skipping capture entirely.
 *
 * Known simplification (flagged for the Processing/STT agents): this does
 * NOT slice the uploaded file into real ~30s audio segments client-side —
 * doing that generically for arbitrary containers (mp4, mov, ...) needs a
 * decode step this pipeline doesn't have. The whole file is uploaded as a
 * single chunk (sequence 0) via the same POST /api/meeting/[id]/chunks
 * route the recorder uses, so the server-side data model/storage path is
 * identical either way. If the STT step needs real 30s slices for an
 * uploaded file, that re-chunking should happen server-side from this one
 * stored file, not here.
 */

import { emitMeetingsChanged } from "../meetingEvents";

export interface FileUploadResult {
  meetingId: string;
}

/** Appended by callers when navigating to the Processing screen after an
 *  upload made from a mobile/tablet viewport (see each caller's `isMobile`
 *  check), so it knows to force the server STT tier instead of running
 *  capability detection (see runLocalMeetingProcessing.ts's
 *  `forceServerTier` doc comment) — that's the case most likely to have the
 *  tab backgrounded or killed mid-transcription. A desktop upload keeps the
 *  same local-first path as live recording. */
export const UPLOAD_SOURCE_QUERY = "?source=upload";

/** Hard cap on an uploaded file's raw size — this pipeline uploads the
 *  WHOLE file as-is (see the module doc comment: no client-side re-encode
 *  or audio-only extraction), so without a limit someone could hand it a
 *  multi-hour 4K video and have the server store and (on a mobile upload,
 *  or if local STT fails) transcribe every byte of video it doesn't even
 *  need. 2GB comfortably covers several hours of compressed audio-only
 *  recordings — the actual target use case — while still ruling out that
 *  kind of raw-video dump; also enforced server-side in
 *  app/api/meeting/route.ts's POST handler, since a client-side check alone
 *  can be bypassed. */
export const MAX_UPLOAD_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Thrown when the picked file exceeds MAX_UPLOAD_FILE_SIZE_BYTES — caught
 *  before any meeting row is created, so it never leaves behind an orphaned
 *  empty meeting the way a mid-upload failure does. */
export class FileTooLargeError extends Error {
  constructor(fileSizeBytes: number) {
    super(
      `File is too large (${formatMegabytes(fileSizeBytes)}). The maximum upload size is ${formatMegabytes(MAX_UPLOAD_FILE_SIZE_BYTES)} — try trimming the recording or exporting an audio-only version first.`,
    );
    this.name = "FileTooLargeError";
  }
}

/** Thrown when the meeting row was created but the file upload itself
 *  failed after every retry — carries `meetingId` so the caller (Home
 *  screen) can offer a "Retry upload" action against the SAME meeting
 *  instead of the user having to re-pick the file and create a duplicate
 *  meeting row. */
export class RecordingUploadError extends Error {
  constructor(
    public readonly meetingId: string,
    message: string,
  ) {
    super(message);
    this.name = "RecordingUploadError";
  }
}

async function createMeetingForFile(file: File, title: string, sttLanguage: string): Promise<string> {
  const res = await fetch("/api/meeting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      status: "UPLOADING",
      fileSizeBytes: file.size,
      mimeType: file.type || null,
      sttLanguage,
    }),
  });
  if (!res.ok) throw new Error("Failed to create meeting");
  const data = (await res.json()) as { id: string };
  emitMeetingsChanged();
  return data.id;
}

const MAX_UPLOAD_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [1_000, 4_000];

async function uploadWholeFileAsChunkOnce(meetingId: string, file: File): Promise<boolean> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("sequence", "0");
  form.append("sizeBytes", String(file.size));
  try {
    const res = await fetch(`/api/meeting/${meetingId}/chunks`, { method: "POST", body: form });
    return res.ok;
  } catch {
    // Network loss — caller retries.
    return false;
  }
}

/** Retries a few times with backoff before giving up — a single flaky
 *  network blip used to fail the whole upload with no recourse but
 *  re-picking the file from scratch (see MeetingHome.tsx's `retryUpload`,
 *  which resumes from here using the already-selected File instead). */
async function uploadWholeFileAsChunk(meetingId: string, file: File): Promise<void> {
  for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS; attempt++) {
    if (await uploadWholeFileAsChunkOnce(meetingId, file)) return;
    if (attempt < MAX_UPLOAD_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
    }
  }
  throw new Error("Failed to upload the recording file");
}

async function finalizeUploadedFile(meetingId: string): Promise<void> {
  const res = await fetch(`/api/meeting/${meetingId}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedChunkCount: 1 }),
  });
  if (!res.ok) throw new Error("The server did not accept the complete recording yet");
}

/** Uploads an already-created meeting's file — used both by the initial
 *  upload and by a manual retry after the initial attempt exhausted its
 *  own retries (MeetingHome.tsx keeps the meetingId + File around for
 *  exactly that). */
export async function retryUploadRecordingFile(meetingId: string, file: File): Promise<void> {
  await uploadWholeFileAsChunk(meetingId, file);
  await finalizeUploadedFile(meetingId);
}

export async function uploadRecordingFile(file: File, title: string, sttLanguage: string): Promise<FileUploadResult> {
  if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) throw new FileTooLargeError(file.size);
  const meetingId = await createMeetingForFile(file, title, sttLanguage);
  try {
    await uploadWholeFileAsChunk(meetingId, file);
  } catch (err) {
    throw new RecordingUploadError(meetingId, err instanceof Error ? err.message : "Failed to upload the recording file");
  }
  try {
    await finalizeUploadedFile(meetingId);
  } catch (err) {
    // The file is already on the server; offer the same manual retry as a failed upload.
    throw new RecordingUploadError(meetingId, err instanceof Error ? err.message : "The server did not accept the complete recording yet");
  }
  return { meetingId };
}
