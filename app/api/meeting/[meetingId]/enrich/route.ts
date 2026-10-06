import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { ensureMeetingEnrichment } from "@/lib/meeting/ai/ensureMeetingEnrichment";

export const runtime = "nodejs";

/**
 * Durable retry surface for Overview/insight generation. The transcript is
 * already READY; this endpoint only (re)runs enrichment and is safe to call
 * after a server restart because ensureMeetingEnrichment is idempotent.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { meetingId: string } },
) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({
    where: { id: params.meetingId },
    select: { ownerEmail: true },
  });
  if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await ensureMeetingEnrichment(params.meetingId, email);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Meeting enrichment failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
