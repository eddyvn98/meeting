import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { resolveMeetingAccess } from "../../_access";
import { findFullAudio, mergedAudioPath } from "@/lib/meeting/audio/paths";
import { parseSingleByteRange } from "@/lib/meeting/audio/httpRange";

/**
 * GET /api/meeting/[meetingId]/audio — streams the meeting's recorded audio
 * back to the sticky player (MeetingAudioPlayer), with HTTP Range support so
 * scrubbing/seeking doesn't have to download the whole file first. Files
 * live under data/meeting-audio/ (never public/, see chunks/route.ts), so
 * this route is the only way to read them back.
 *
 * Prefers the stitched `merged.m4a` file (lib/meeting/audio/mergeAudioChunks.ts,
 * written by finalize/route.ts for a multi-chunk live recording) when it
 * exists; falls back to the sequence-0 chunk otherwise. For the "Upload
 * Recording" flow, sequence-0 already IS the whole file, so there is nothing
 * to merge and this always serves it directly.
 */
export const runtime = "nodejs";

const MIME_BY_EXT: Record<string, string> = {
  webm: "audio/webm",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  mp3: "audio/mpeg",
};

export async function GET(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  const accessRole = meeting ? await resolveMeetingAccess(meeting, email) : null;
  if (!meeting || !accessRole) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let filePath = mergedAudioPath(meeting.id);
  let fileStat: Awaited<ReturnType<typeof stat>> | null = null;

  // `?part=N` serves one stored part, so a recording that could not be merged
  // can still be downloaded piece by piece (see audio-parts/route.ts).
  const partParam = req.nextUrl.searchParams.get("part");
  if (partParam !== null) {
    const sequence = Number(partParam);
    if (!Number.isInteger(sequence) || sequence < 0) return NextResponse.json({ error: "Invalid part" }, { status: 400 });
    const part = await prisma.audioChunk.findUnique({ where: { meetingId_sequence: { meetingId: meeting.id, sequence } } });
    if (!part?.storageUrl) return NextResponse.json({ error: "No such part" }, { status: 404 });
    filePath = part.storageUrl;
    fileStat = await stat(filePath).catch(() => null);
    if (!fileStat) return NextResponse.json({ error: "Audio file missing on disk" }, { status: 404 });
  } else {
    fileStat = await stat(filePath).catch(() => null);
  }

  if (!fileStat) {
    // No merged file (or its re-encode failed): the continuous recording, if any.
    const fullPath = await findFullAudio(meeting.id);
    if (fullPath) {
      filePath = fullPath;
      fileStat = await stat(filePath).catch(() => null);
    }
  }

  if (!fileStat) {
    const chunk = await prisma.audioChunk.findUnique({
      where: { meetingId_sequence: { meetingId: meeting.id, sequence: 0 } },
    });
    if (!chunk?.storageUrl) return NextResponse.json({ error: "No audio available" }, { status: 404 });
    filePath = chunk.storageUrl;
    fileStat = await stat(filePath).catch(() => null);
    if (!fileStat) return NextResponse.json({ error: "Audio file missing on disk" }, { status: 404 });
  }

  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const contentType = MIME_BY_EXT[ext] ?? "application/octet-stream";
  const range = req.headers.get("range");

  if (!range) {
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileStat.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const parsedRange = parseSingleByteRange(range, fileStat.size);
  if (!parsedRange) {
    return new NextResponse(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${fileStat.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }
  const { start, end } = parsedRange;
  const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;

  return new NextResponse(stream, {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
