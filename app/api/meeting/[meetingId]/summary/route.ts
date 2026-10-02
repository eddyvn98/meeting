import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMeetingEditor } from "../sections/_shared";
import { serializeMeetingSummary } from "@/lib/meeting/serialize";

/** PATCH /api/meeting/[meetingId]/summary — edits the prose `overview` text
 *  shown at the top of the Overview tab (MeetingSummaryCard.tsx). Owner or
 *  editor, same rule as the section-editing routes (reused via
 *  requireMeetingEditor even though this route isn't itself under
 *  .../sections/). Body: `{ overview: string }`. */
export async function PATCH(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const auth = await requireMeetingEditor(req, params.meetingId);
  if (!auth.ok) return auth.response;

  let body: { overview?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.overview !== "string") {
    return NextResponse.json({ error: "overview must be a string" }, { status: 400 });
  }

  const updated = await prisma.meetingSummary.update({
    where: { id: auth.summary.id },
    data: { overview: body.overview },
    include: { topics: true, decisions: true, actionItems: true, blockers: true, openQuestions: true, sections: { orderBy: { order: "asc" } } },
  });

  return NextResponse.json(serializeMeetingSummary(updated));
}
