import { NextRequest, NextResponse } from "next/server";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { acceptsAudio } from "@/lib/meeting/audio/finalizeRetry";
import { meetingAudioDir } from "@/lib/meeting/audio/paths";

export const runtime = "nodejs";

class MeetingClosedError extends Error {}

const MAX_FULL_AUDIO_BYTES = 300 * 1024 * 1024;

function extForMimeType(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  return "bin";
}

/**
 * POST /api/meeting/[meetingId]/full-audio — multipart `file`: the whole
 * meeting as ONE continuous recording, uploaded at End Meeting. The chunks
 * remain the live-transcription feed and the fallback; this file has no joins
 * between pieces, so it plays without the dropouts a re-encoded concatenation
 * of chunks can have. finalize/route.ts prefers it when it is readable.
 * Replaces an earlier upload for the same meeting. Owner only.
 */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!acceptsAudio(meeting)) {
    return NextResponse.json({ error: "Meeting is no longer accepting audio", code: "MEETING_CLOSED" }, { status: 409 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Failed to parse multipart form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "Empty file" }, { status: 400 });
  if (file.size > MAX_FULL_AUDIO_BYTES) return NextResponse.json({ error: "Recording exceeds the 300 MB limit" }, { status: 413 });

  const dir = meetingAudioDir(meeting.id);
  await mkdir(dir, { recursive: true });
  const target = join(dir, `full.${extForMimeType(file.type || "")}`);
  const temp = join(dir, `.full.${randomUUID()}.uploading`);
  await writeFile(temp, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
  const published = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`meeting-audio:${meeting.id}`}))`;
    const lockedMeeting = await tx.meeting.findUnique({ where: { id: meeting.id } });
    if (!lockedMeeting || lockedMeeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
      throw new Error("Meeting not found");
    }
    if (!acceptsAudio(lockedMeeting)) throw new MeetingClosedError();
    await rename(temp, target);
    const targetName = target.slice(dir.length + 1);
    const staleFullFiles = (await readdir(dir))
      .filter((name) =>
        name.startsWith("full.") &&
        !name.endsWith(".uploading") &&
        name !== targetName
      );
    await Promise.all(
      staleFullFiles.map((name) => rm(join(dir, name), { force: true })),
    );
    return true;
  }, { maxWait: 15_000, timeout: 30_000 }).catch(async (error) => {
    await rm(temp, { force: true }).catch(() => undefined);
    if (error instanceof MeetingClosedError) return false;
    throw error;
  });
  if (!published) {
    return NextResponse.json(
      { error: "Meeting is no longer accepting audio", code: "MEETING_CLOSED" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, sizeBytes: file.size }, { status: 201 });
}
