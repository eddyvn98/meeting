import { NextRequest, NextResponse } from "next/server";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { serializeAudioChunk } from "@/lib/meeting/serialize";
import { acceptsAudio } from "@/lib/meeting/audio/finalizeRetry";
import { meetingAudioDir } from "@/lib/meeting/audio/paths";

/**
 * Server-side durability backup for the recording pipeline's local
 * (IndexedDB) chunk store — see lib/meeting/recorder/. STT/diarization runs
 * client-side (per the Meeting architecture note), so this route is
 * NOT the pipeline's source of truth for transcription; it only gives the
 * recorder something to ACK against so a chunk can be dropped from the
 * retry queue, and gives ops a durable copy if the browser tab is lost.
 * Files are written under data/meeting-audio/<meetingId>/ rather than
 * public/ (never web-served) — same "server-local disk, not a URL" choice
 * app/api/finance/upload/route.ts makes for its uploads directory.
 */
export const runtime = "nodejs";

/** The meeting already left UPLOADING (finalized or failed); retrying cannot help. */
class MeetingClosedError extends Error {}

function extForMimeType(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  return "bin";
}

function asInt(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

/** POST /api/meeting/[meetingId]/chunks — accepts one recorded (or whole
 *  uploaded-file) audio chunk as multipart form data:
 *  - file: Blob/File (required)
 *  - sequence: string int (required) — chunk order, 0-based
 *  - durationSec, sizeBytes: string int (optional)
 *  Upserts on the (meetingId, sequence) unique constraint so a retried
 *  upload of the same chunk is idempotent rather than erroring. */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Failed to parse multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  const sequence = asInt(form.get("sequence"));
  if (sequence === undefined || sequence < 0) {
    return NextResponse.json({ error: "sequence must be a non-negative integer" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const maxChunkBytes = 100 * 1024 * 1024;
  if (buffer.byteLength === 0) return NextResponse.json({ error: "Empty file" }, { status: 400 });
  if (buffer.byteLength > maxChunkBytes) {
    return NextResponse.json({ error: "Chunk exceeds the 100 MB limit" }, { status: 413 });
  }
  const ext = extForMimeType(file.type || "");
  const meetingDir = meetingAudioDir(meeting.id);
  await mkdir(meetingDir, { recursive: true });
  const targetPath = join(meetingDir, `${sequence}.${ext}`);
  const tempPath = join(meetingDir, `.${sequence}.${randomUUID()}.uploading`);

  const durationSec = asInt(form.get("durationSec"));
  const sizeBytes = asInt(form.get("sizeBytes")) ?? buffer.byteLength;

  const chunk = await prisma.$transaction(async (tx) => {
    // Serialize uploads and finalize for one meeting across all Node instances.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`meeting-audio:${meeting.id}`}))`;
    const lockedMeeting = await tx.meeting.findUnique({ where: { id: meeting.id } });
    if (!lockedMeeting || lockedMeeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
      throw new Error("Meeting not found");
    }
    if (!acceptsAudio(lockedMeeting)) {
      throw new MeetingClosedError();
    }
    try {
      await writeFile(tempPath, buffer, { flag: "wx" });
      await rename(tempPath, targetPath);
      return await tx.audioChunk.upsert({
        where: { meetingId_sequence: { meetingId: lockedMeeting.id, sequence } },
        create: {
          meetingId: lockedMeeting.id,
          sequence,
          storageUrl: targetPath,
          durationSec,
          sizeBytes,
          status: "UPLOADED",
        },
        update: {
          storageUrl: targetPath,
          durationSec,
          sizeBytes,
          status: "UPLOADED",
        },
      });
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }, { maxWait: 15_000, timeout: 120_000 }).catch((error) => {
    if (error instanceof MeetingClosedError) return null;
    throw error;
  });
  if (!chunk) {
    return NextResponse.json({ error: "Meeting is no longer accepting audio chunks", code: "MEETING_CLOSED" }, { status: 409 });
  }

  return NextResponse.json(serializeAudioChunk(chunk), { status: 201 });
}
