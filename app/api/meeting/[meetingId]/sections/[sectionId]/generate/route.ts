import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireMeetingEditor } from "../../_shared";
import { serializeOverviewSection } from "@/lib/meeting/serialize";
import { defaultTitleFor, parseSectionItems } from "@/lib/meeting/overviewSections";
import { resolveOutputLanguage } from "@/lib/meeting/outputLanguage";
import { isGeneratableKind, mergeGeneratedItems } from "@/lib/meeting/sectionGeneration";
import { generateSectionItems } from "@/lib/meeting/ai/meetingSectionAgent";

/**
 * POST /api/meeting/[meetingId]/sections/[sectionId]/generate — asks the AI for
 * items for ONE Overview section, from the meeting's saved transcript, and
 * ADDS the new ones to what the section already holds. Nothing existing is
 * edited, reordered or removed, so the user's own items and the AI's sit side
 * by side (items already in the section are also not re-added). Because it
 * never overwrites, there is no confirm step. Owner-or-editor.
 *
 * Body (optional): `{ language }` — a TRANSLATE_LANGUAGES code or "auto" (the
 * meeting's recording language). Responds with `{ section, added }`.
 */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string; sectionId: string } }) {
  const auth = await requireMeetingEditor(req, params.meetingId);
  if (!auth.ok) return auth.response;

  const section = await prisma.meetingOverviewSection.findUnique({ where: { id: params.sectionId } });
  if (!section || section.summaryId !== auth.summary.id) {
    return NextResponse.json({ error: "Section not found" }, { status: 404 });
  }
  if (!isGeneratableKind(section.kind)) {
    return NextResponse.json({ error: "AI generation is not available for this kind of section" }, { status: 400 });
  }
  const kind = section.kind;

  let body: { language?: unknown } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const language = resolveOutputLanguage(body.language, auth.meeting.sttLanguage);
  if (!language.ok) return NextResponse.json({ error: "Unsupported language" }, { status: 400 });

  const segments = await prisma.transcriptSegment.findMany({
    where: { meetingId: auth.meeting.id },
    orderBy: { order: "asc" },
  });
  if (segments.length === 0) {
    return NextResponse.json({ error: "This meeting has no transcript yet" }, { status: 400 });
  }

  const existing = parseSectionItems(kind, section.items);
  const generated = await generateSectionItems({
    kind,
    sectionTitle: section.title || defaultTitleFor(kind),
    meetingTitle: auth.meeting.title,
    transcript: segments.map((s) => ({ segmentId: s.id, speaker: s.speakerKey, text: s.textEn ?? s.textVi ?? "" })),
    existing,
    callerEmail: auth.email,
    outputLanguage: language.label,
  });
  if (generated === null) {
    return NextResponse.json({ error: "The AI could not be reached. Please try again." }, { status: 502 });
  }

  if (mergeGeneratedItems(existing, generated).added === 0) {
    return NextResponse.json({ section: serializeOverviewSection(section), added: 0 });
  }

  // The AI takes tens of seconds, during which the user may have edited this
  // section. Merge into the freshest items and write only if nobody changed the
  // row in between (compare-and-set on `updatedAt`, as the minutes generator
  // does); on a race, re-read and merge again rather than dropping their edit.
  // `source` is left as is: AI additions do not turn an AI section into a user
  // one, and a user's own section stays theirs.
  for (let attempt = 0; attempt < 3; attempt++) {
    const fresh = await prisma.meetingOverviewSection.findUnique({ where: { id: section.id } });
    if (!fresh) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    const final = mergeGeneratedItems(parseSectionItems(kind, fresh.items), generated);
    if (final.added === 0) return NextResponse.json({ section: serializeOverviewSection(fresh), added: 0 });

    const update = await prisma.meetingOverviewSection.updateMany({
      where: { id: fresh.id, updatedAt: fresh.updatedAt },
      data: { items: final.items as unknown as Prisma.InputJsonValue },
    });
    if (update.count === 1) {
      const saved = await prisma.meetingOverviewSection.findUnique({ where: { id: fresh.id } });
      if (saved) return NextResponse.json({ section: serializeOverviewSection(saved), added: final.added });
    }
  }
  return NextResponse.json({ error: "This section kept changing while the AI was working. Please try again." }, { status: 409 });
}
