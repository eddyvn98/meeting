import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../../_auth";
import { resolveMeetingAccess } from "../../../_access";
import { requireMeetingEditor } from "../../sections/_shared";
import { generateTranslations } from "@/lib/meeting/ai/difyMeetingAgent";
import { glossaryContextBlock } from "@/lib/meeting/glossary/applyGlossary";
import { TRANSLATE_LANGUAGES, labelForTranslateLang } from "@/lib/meeting/translateLanguages";
import { loadOriginalMinutes, toClientTranslation } from "@/lib/meeting/minutesSource";
import { parseMinutesDocContent, translateMinutesContent, type MinutesTranslation } from "@/lib/meeting/minutesTranslation";

export const runtime = "nodejs";

/** GET /api/meeting/[meetingId]/minutes/translations — every saved language
 *  version. Any caller with view access (owner, editor or viewer) can read
 *  them, so a shared viewer can switch between languages. */
export async function GET(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  const accessRole = meeting ? await resolveMeetingAccess(meeting, email) : null;
  if (!meeting || !accessRole) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [rows, original] = await Promise.all([
    prisma.meetingMinutesTranslation.findMany({ where: { meetingId: meeting.id }, orderBy: { createdAt: "asc" } }),
    loadOriginalMinutes(meeting, null),
  ]);
  const translations = rows.map((row) => toClientTranslation(row, original.updatedAt)).filter((t): t is MinutesTranslation => t !== null);
  return NextResponse.json({ translations });
}

/** POST /api/meeting/[meetingId]/minutes/translations — body `{ language }`.
 *  Translates the CURRENT original minutes (including manual edits) into that
 *  language and saves it, replacing an earlier version of the same language.
 *  Owner or editor only. */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const auth = await requireMeetingEditor(req, params.meetingId);
  if (!auth.ok) return auth.response;

  let body: { language?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const language = typeof body.language === "string" ? body.language : "";
  if (!TRANSLATE_LANGUAGES.some((l) => l.code === language)) {
    return NextResponse.json({ error: "Unsupported language" }, { status: 400 });
  }

  const original = await loadOriginalMinutes(auth.meeting, req.nextUrl.searchParams.get("tz"));
  const glossary = await prisma.meetingGlossaryTerm.findMany({ where: { ownerEmail: auth.meeting.ownerEmail } });
  const glossaryBlock = glossaryContextBlock(glossary);
  const label = labelForTranslateLang(language);

  let content;
  try {
    content = await translateMinutesContent(original.content, (lines) => generateTranslations(lines, label, auth.email, glossaryBlock));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Translation failed" }, { status: 502 });
  }

  const row = await prisma.meetingMinutesTranslation.upsert({
    where: { meetingId_language: { meetingId: auth.meeting.id, language } },
    create: { meetingId: auth.meeting.id, language, content: content as never, sourceUpdatedAt: original.updatedAt },
    update: { content: content as never, sourceUpdatedAt: original.updatedAt },
  });
  const translation = toClientTranslation(row, original.updatedAt);
  return NextResponse.json({ translation });
}
