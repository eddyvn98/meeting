import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";

export const runtime = "nodejs";

/**
 * Refreshes Meeting.updatedAt while a real transcription run is actively
 * driving a PROCESSING meeting. The stale-processing sweep uses updatedAt as
 * its lease timestamp, so progress from a multi-hour recording must keep that
 * lease alive instead of being mistaken for an abandoned browser/process.
 *
 * Recorder JWTs are still limited by recorderScope.ts to their one bound
 * Meeting. This endpoint never changes status or transcript data.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { meetingId: string } },
) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({
    where: { id: params.meetingId },
    select: { ownerEmail: true, status: true },
  });
  if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (meeting.status === "PROCESSING") {
    await prisma.meeting.updateMany({
      where: { id: params.meetingId, status: "PROCESSING" },
      data: { updatedAt: new Date() },
    });
  }

  return new NextResponse(null, { status: 204 });
}
