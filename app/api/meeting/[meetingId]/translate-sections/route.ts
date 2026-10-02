import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { resolveMeetingAccess } from "../../_access";
import { generateTranslations } from "@/lib/meeting/ai/difyMeetingAgent";
import { serializeMeetingSummary } from "@/lib/meeting/serialize";
import { labelForTranslateLang } from "@/lib/meeting/translateLanguages";
import { buildSummaryTranslationLines, splitSummaryTranslations } from "@/lib/meeting/translateSummary";
import { glossaryContextBlock } from "@/lib/meeting/glossary/applyGlossary";

/**
 * POST /api/meeting/[meetingId]/translate-sections — translates ONLY the
 * given Overview sections (and optionally the overview text) into `targetLang`.
 * Used after a full translation exists and the summary then changed: a section
 * added by hand, filled by "Generate with AI", or edited. Nothing is saved
 * server-side; the client merges the result into its translation cache.
 *
 * Body: `{ targetLang: string, sectionIds?: string[], overview?: boolean }`.
 * Responds with `{ overview: string | null, sections: Record<id, fields> }`.
 */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  const accessRole = meeting ? await resolveMeetingAccess(meeting, email) : null;
  if (!meeting || !accessRole) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: { targetLang?: unknown; sectionIds?: unknown; overview?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.targetLang !== "string" || !body.targetLang) {
    return NextResponse.json({ error: "targetLang is required" }, { status: 400 });
  }
  const sectionIds = Array.isArray(body.sectionIds) ? body.sectionIds.filter((id): id is string => typeof id === "string") : [];
  const wantOverview = body.overview === true;
  if (sectionIds.length === 0 && !wantOverview) return NextResponse.json({ overview: null, sections: {} });

  const summaryRow = await prisma.meetingSummary.findUnique({
    where: { meetingId: meeting.id },
    include: { topics: true, decisions: true, actionItems: true, blockers: true, openQuestions: true, sections: { orderBy: { order: "asc" } } },
  });
  if (!summaryRow) return NextResponse.json({ overview: null, sections: {} });

  const summary = serializeMeetingSummary(summaryRow);
  const subset = {
    overview: wantOverview ? summary.overview : "",
    topics: [],
    sections: summary.sections.filter((section) => sectionIds.includes(section.id)),
  };
  const lines = buildSummaryTranslationLines(subset);
  if (lines.length === 0) return NextResponse.json({ overview: null, sections: {} });

  const ownerGlossary = await prisma.meetingGlossaryTerm.findMany({ where: { ownerEmail: meeting.ownerEmail } });
  const translations = await generateTranslations(lines, labelForTranslateLang(body.targetLang), email, glossaryContextBlock(ownerGlossary));
  if (!translations) return NextResponse.json({ error: "Translation is unavailable right now" }, { status: 502 });

  const translated = splitSummaryTranslations(subset, translations);
  return NextResponse.json({ overview: translated.overview, sections: translated.sections });
}
