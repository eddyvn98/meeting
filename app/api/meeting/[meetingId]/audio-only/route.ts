import { NextRequest, NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { serializeMeeting } from "@/lib/meeting/serialize";
import { mergedAudioPath } from "@/lib/meeting/audio/paths";
import { AUDIO_ONLY_PREFIX } from "@/lib/meeting/audio/audioOnly";

export const runtime = "nodejs";

/**
 * POST /api/meeting/[meetingId]/audio-only — body `{ reason? }`. The way out
 * when transcription cannot be completed (the speech engine hangs or fails,
 * the audio cannot be decoded, the server could not merge the parts): the
 * meeting becomes a READY, transcript-less Overview where the recording can be
 * played and downloaded, and transcription can be retried later. Owner only.
 * Works from PROCESSING and FAILED (including a failed finalize, where the
 * recording is still stored as separate parts). Refuses only when no audio is
 * stored at all. Never writes any placeholder transcript or summary.
 */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (meeting.status === "READY") return NextResponse.json(serializeMeeting(meeting));
  if (meeting.status === "UPLOADING") {
    return NextResponse.json({ error: "The recording is still being uploaded" }, { status: 409 });
  }

  const chunks = await prisma.audioChunk.findMany({ where: { meetingId: meeting.id }, orderBy: { sequence: "asc" } });
  const chunkChecks = await Promise.all(chunks.map((chunk) => (chunk.storageUrl ? stat(chunk.storageUrl).then(() => true, () => false) : Promise.resolve(false))));
  const hasMerged = await stat(mergedAudioPath(meeting.id)).then(() => true, () => false);
  if (!hasMerged && !chunkChecks.some(Boolean)) {
    return NextResponse.json({ error: "No audio is stored for this meeting" }, { status: 409 });
  }

  let body: { reason?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // The reason is optional.
  }
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 300) : "Transcription was skipped.";
  const summedDurationSec = chunks.reduce((sum, chunk) => sum + (chunk.durationSec ?? 0), 0);

  const updated = await prisma.meeting.update({
    where: { id: meeting.id },
    data: {
      status: "READY",
      failureReason: `${AUDIO_ONLY_PREFIX}${reason}`,
      isMockResult: false,
      audioUrl: `/api/meeting/${meeting.id}/audio`,
      durationSec: meeting.durationSec ?? (summedDurationSec > 0 ? summedDurationSec : null),
    },
  });
  return NextResponse.json(serializeMeeting(updated));
}
