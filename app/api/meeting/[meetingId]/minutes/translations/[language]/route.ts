import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMeetingEditor } from "../../../sections/_shared";
import { parseMinutesDocContent } from "@/lib/meeting/minutesTranslation";

export const runtime = "nodejs";

/** PATCH /api/meeting/[meetingId]/minutes/translations/[language] — saves manual
 *  edits to one language version. Body `{ content }`. Owner or editor only. */
export async function PATCH(req: NextRequest, { params }: { params: { meetingId: string; language: string } }) {
  const auth = await requireMeetingEditor(req, params.meetingId);
  if (!auth.ok) return auth.response;

  let body: { content?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const content = parseMinutesDocContent(body.content);
  if (!content) return NextResponse.json({ error: "Invalid minutes content" }, { status: 400 });

  const result = await prisma.meetingMinutesTranslation.updateMany({
    where: { meetingId: auth.meeting.id, language: params.language },
    data: { content: content as never },
  });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/meeting/[meetingId]/minutes/translations/[language] — removes one
 *  language version. The original minutes are never affected. */
export async function DELETE(req: NextRequest, { params }: { params: { meetingId: string; language: string } }) {
  const auth = await requireMeetingEditor(req, params.meetingId);
  if (!auth.ok) return auth.response;
  await prisma.meetingMinutesTranslation.deleteMany({ where: { meetingId: auth.meeting.id, language: params.language } });
  return NextResponse.json({ ok: true });
}
