import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import type { MeetingPostprocessStatus } from "@/lib/meeting/types";

export const runtime = "nodejs";

const VALID_STATUSES: MeetingPostprocessStatus[] = [
  "PENDING",
  "RUNNING",
  "DONE",
  "FAILED",
];

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

  let body: { task?: unknown; status?: unknown; error?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.task !== "diarization" && body.task !== "enrichment") {
    return NextResponse.json({ error: "task must be diarization or enrichment" }, { status: 400 });
  }
  if (
    typeof body.status !== "string" ||
    !VALID_STATUSES.includes(body.status as MeetingPostprocessStatus)
  ) {
    return NextResponse.json({ error: "Invalid postprocess status" }, { status: 400 });
  }

  const status = body.status as MeetingPostprocessStatus;
  const error =
    status === "FAILED" && typeof body.error === "string"
      ? body.error.slice(0, 4000)
      : null;

  const updated = await prisma.meeting.update({
    where: { id: params.meetingId },
    data:
      body.task === "diarization"
        ? { diarizationStatus: status, diarizationError: error }
        : { enrichmentStatus: status, enrichmentError: error },
  });

  return NextResponse.json({
    diarizationStatus: updated.diarizationStatus,
    diarizationError: updated.diarizationError,
    enrichmentStatus: updated.enrichmentStatus,
    enrichmentError: updated.enrichmentError,
  });
}
