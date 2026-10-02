import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { serializeMeeting } from "@/lib/meeting/serialize";
import { applyMockComplete } from "@/lib/meeting/processing/applyMockComplete";

/**
 * POST /api/meeting/[meetingId]/mock-complete
 *
 * Guaranteed-completion fallback: the Processing screen calls this only
 * when the real client-side STT attempt (lib/meeting/processing/
 * runLocalMeetingProcessing.ts -> transcript/route.ts) fails or times out —
 * WebAssembly unavailable, the Whisper model fetch is blocked, the tab is
 * too slow/low-power, etc. Writes a clearly-labeled MOCK transcript/summary
 * so the Processing -> Meeting Result flow always completes instead of
 * stalling forever. Every generated row is plainly a placeholder (see
 * applyMockComplete.ts's mock text); a later real transcript/route.ts call
 * (e.g. local STT finishing after this already ran, or a user-triggered
 * retry via POST /api/meeting/[meetingId]/reprocess) fully replaces it.
 * Sets `isMockResult: true` so the result screen can show a real "Retry"
 * action instead of the dead "re-open to retry" advice this used to bake
 * into the placeholder text (re-opening a READY meeting never re-ran
 * anything).
 *
 * The write path itself lives in applyMockComplete.ts, shared with the
 * claim route's stale-PROCESSING recovery sweep (see
 * app/api/meeting/bot-sessions/claim/route.ts) and with the unattended
 * meeting bot runner's processing-timeout fallback (see
 * scripts/meeting-bot-runner.mjs), which calls this same endpoint.
 */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await applyMockComplete(meeting);
  return NextResponse.json(serializeMeeting(updated));
}
