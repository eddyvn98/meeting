import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../../_auth";
import { resolveMeetingAccess } from "../../../_access";

const MAX_SEGMENT_TEXT_LENGTH = 20_000;

/**
 * PATCH /api/meeting/[meetingId]/segments/[segmentId] — corrects the text of
 * one transcript segment (the original-language text). Owner or editor only.
 * The saved translation of that segment is cleared, since it no longer matches
 * the corrected text; it shows as missing until the meeting is translated again.
 *
 * Body: `{ text: string }`. Responds with `{ id, textEn }`.
 */
export async function PATCH(req: NextRequest, { params }: { params: { meetingId: string; segmentId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  const role = meeting ? await resolveMeetingAccess(meeting, email) : null;
  if (!meeting || (role !== "owner" && role !== "editor")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "text cannot be empty" }, { status: 400 });
  if (text.length > MAX_SEGMENT_TEXT_LENGTH) return NextResponse.json({ error: "text is too long" }, { status: 400 });

  // Scoped by meetingId so a segment of another meeting can never be edited here.
  const updated = await prisma.transcriptSegment.updateMany({
    where: { id: params.segmentId, meetingId: meeting.id },
    data: { textEn: text, textVi: null },
  });
  if (updated.count === 0) return NextResponse.json({ error: "Segment not found" }, { status: 404 });

  return NextResponse.json({ id: params.segmentId, textEn: text });
}
