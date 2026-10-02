import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { serializeMeeting } from "@/lib/meeting/serialize";
import { isAudioOnlyResult } from "@/lib/meeting/audio/audioOnly";
import { isStaleProcessing } from "@/lib/meeting/processing/staleProcessing";

// Kept in sync with claim/route.ts's DEFAULT_PROCESSING_STALE_MS — same
// "nothing is going to finish this on its own" deadline, just checked
// on-demand here instead of on the claim-poll sweep.
const DEFAULT_PROCESSING_STALE_MS = 2 * 60 * 60_000;

function staleThresholdMs(): number {
  const raw = Number(process.env.MEETING_PROCESSING_STALE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PROCESSING_STALE_MS;
}

/**
 * POST /api/meeting/[meetingId]/reprocess
 *
 * Real retry for a meeting stuck on the mock-complete/route.ts placeholder
 * (isMockResult: true) — previously the only advice given ("re-open this
 * meeting to retry") did nothing, since a READY meeting redirects straight
 * to the result page instead of back through Processing. This route is what
 * that retry actually needs: flip status back to PROCESSING (audio itself
 * was never touched by mock-complete, so it's still on disk) so the client
 * navigates to /meeting/[meetingId]/processing, whose mount effect always
 * re-runs runLocalMeetingProcessing.ts against the real audio.
 *
 * Owner-only. Also allowed for an audio-only meeting (transcription was skipped,
 * see audio-only/route.ts). Allowed in two cases: the current result actually IS the mock
 * placeholder (isMockResult), or the meeting has been stuck in PROCESSING
 * past MEETING_PROCESSING_STALE_MS with nothing left to finish it (same
 * staleness the claim route's recovery sweep uses) — that lets an owner
 * un-stick a meeting immediately instead of waiting for the next sweep or
 * the bot runner's own timeout. Otherwise refuses, so a stray retry click
 * can never discard a real, still-in-progress or already-genuine result.
 */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const stuckInProcessing = isStaleProcessing(meeting.status, meeting.updatedAt.getTime(), Date.now(), staleThresholdMs());
  if (!meeting.isMockResult && !stuckInProcessing && !isAudioOnlyResult(meeting)) {
    return NextResponse.json({ error: "This meeting doesn't have a mock result to retry" }, { status: 400 });
  }

  const updated = await prisma.meeting.update({
    where: { id: meeting.id },
    data: { status: "PROCESSING", failureReason: null },
  });
  return NextResponse.json(serializeMeeting(updated));
}
