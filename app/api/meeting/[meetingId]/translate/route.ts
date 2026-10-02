import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { resolveMeetingAccess } from "../../_access";
import { generateTranslations } from "@/lib/meeting/ai/difyMeetingAgent";
import { serializeMeetingSummary } from "@/lib/meeting/serialize";
import { DEFAULT_TRANSLATE_LANG, labelForTranslateLang } from "@/lib/meeting/translateLanguages";
import { buildSummaryTranslationLines, splitSummaryTranslations } from "@/lib/meeting/translateSummary";
import { glossaryContextBlock } from "@/lib/meeting/glossary/applyGlossary";

/**
 * POST /api/meeting/[meetingId]/translate — on-demand translation into a
 * caller-chosen target language for BOTH the transcript AND the Overview
 * summary (overview text, topics, decisions, action items, blockers, open
 * questions) in one batched call — triggered by the "Translate" button in
 * the Transcript tab (MeetingTranscriptTab.tsx via useMeetingTranslation.ts,
 * shared with the Overview tab so a single translate action covers the
 * whole meeting, not just the raw script).
 *
 * Only `targetLang: "vi"` transcript segments are persisted, into
 * TranscriptSegment.textVi — the only translated-text column the schema
 * has. Everything else (any other language's segments, and the summary
 * translation regardless of language — MeetingSummary/Topic/Decision/etc
 * have no translated-text columns at all) is returned but NOT saved
 * server-side; the client caches it for the session instead (see
 * useMeetingTranslation.ts). Re-translates everything each call (simplest
 * correct behavior — this module has no per-field dirty tracking).
 */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  const accessRole = meeting ? await resolveMeetingAccess(meeting, email) : null;
  if (!meeting || !accessRole) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { targetLang?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // No body is fine — defaults to Vietnamese, the original behavior.
  }
  const targetLang = typeof body.targetLang === "string" && body.targetLang ? body.targetLang : DEFAULT_TRANSLATE_LANG;

  const [segments, summaryRow] = await Promise.all([
    prisma.transcriptSegment.findMany({ where: { meetingId: meeting.id }, orderBy: { order: "asc" } }),
    prisma.meetingSummary.findUnique({
      where: { meetingId: meeting.id },
      include: { topics: true, decisions: true, actionItems: true, blockers: true, openQuestions: true, sections: { orderBy: { order: "asc" } } },
    }),
  ]);
  if (segments.length === 0) {
    return NextResponse.json({ error: "No transcript to translate yet" }, { status: 400 });
  }

  // splitSummaryTranslations/buildSummaryTranslationLines walk `sections`
  // (the dynamic overview), not the legacy Decision/ActionItem/Blocker/
  // OpenQuestion tables — serializeMeetingSummary already synthesizes
  // legacy-equivalent sections for any summary that somehow has none yet.
  const summary = summaryRow ? serializeMeetingSummary(summaryRow) : null;
  const segmentLines = segments.map((s) => s.textEn ?? "");
  const summaryLines = summary ? buildSummaryTranslationLines(summary) : [];
  const targetLabel = labelForTranslateLang(targetLang);
  // The meeting OWNER's glossary, not the caller's — a shared viewer
  // translating this meeting should still get the domain terms the owner
  // set up for it, regardless of whose glossary (if any) the viewer has.
  const ownerGlossary = await prisma.meetingGlossaryTerm.findMany({ where: { ownerEmail: meeting.ownerEmail } });
  const glossaryBlock = glossaryContextBlock(ownerGlossary);

  // Two separate calls, NOT one combined list: the agent prompt truncates
  // at MAX_TRANSCRIPT_CHARS (difyMeetingAgent.ts), and the transcript alone
  // routinely exceeds that on a real meeting — concatenating summary lines
  // after it silently dropped the summary translation every time (confirmed
  // live: summary came back all-null on a 91-segment meeting). Each gets
  // its own budget instead.
  const [segmentTranslations, summaryTranslationsRaw] = await Promise.all([
    generateTranslations(segmentLines, targetLabel, email, glossaryBlock),
    summaryLines.length > 0 ? generateTranslations(summaryLines, targetLabel, email, glossaryBlock) : Promise.resolve(null),
  ]);
  if (!segmentTranslations) {
    return NextResponse.json({ error: "Translation is unavailable right now" }, { status: 502 });
  }

  const updates = segments
    .map((seg, i) => (segmentTranslations[i] ? { id: seg.id, text: segmentTranslations[i] as string } : null))
    .filter((u): u is { id: string; text: string } => u !== null);

  if (targetLang === DEFAULT_TRANSLATE_LANG && updates.length > 0) {
    await prisma.$transaction(
      updates.map((u) => prisma.transcriptSegment.update({ where: { id: u.id }, data: { textVi: u.text } })),
    );
  }

  const translatedSummary = summary ? splitSummaryTranslations(summary, summaryTranslationsRaw ?? []) : null;

  return NextResponse.json({
    targetLang,
    translated: updates.length,
    total: segments.length,
    segments: updates.map((u) => ({ id: u.id, text: u.text })),
    summary: translatedSummary,
  });
}
