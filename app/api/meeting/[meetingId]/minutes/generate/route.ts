import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireMeetingEditor } from "../../sections/_shared";
import { serializeOverviewSection } from "@/lib/meeting/serialize";
import { DEFAULT_SECTION_TITLES } from "@/lib/meeting/overviewSections";
import { generateMeetingInsights } from "@/lib/meeting/ai/difyMeetingAgent";
import { buildMinutesTableItems } from "@/lib/meeting/ai/buildSummaryCreateInput";
import { resolveOutputLanguage } from "@/lib/meeting/outputLanguage";

/**
 * POST /api/meeting/[meetingId]/minutes/generate — Stage A of the MOM
 * feature: (re)generates ONLY the `minutes_table` section (the MOM matters
 * table) from the meeting's already-saved transcript, leaving every other
 * section (actions/decisions/blockers/etc, and the MeetingMinutes metadata
 * row) untouched. Owner-or-editor (reuses requireMeetingEditor, same rule
 * every other manual-edit route on this meeting uses).
 *
 * The optional `language` body field picks the language the minutes are
 * written in ("auto" = the meeting's recording language).
 *
 * A `minutes_table` section the owner has manually edited (`source ===
 * "user"`) is not silently overwritten: this returns 409 unless the body
 * includes `{ confirmReplace: true }`, mirroring how a destructive
 * regenerate should always require an explicit second confirmation from
 * the caller.
 */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const auth = await requireMeetingEditor(req, params.meetingId);
  if (!auth.ok) return auth.response;

  let body: { confirmReplace?: unknown; language?: unknown } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const confirmReplace = body.confirmReplace === true;

  // `language`: a TRANSLATE_LANGUAGES code, or "auto" (default) to write the
  // minutes in the language the meeting was recorded in.
  const language = resolveOutputLanguage(body.language, auth.meeting.sttLanguage);
  if (!language.ok) return NextResponse.json({ error: "Unsupported language" }, { status: 400 });
  const outputLanguage = language.label;

  const existing = await prisma.meetingOverviewSection.findFirst({
    where: { summaryId: auth.summary.id, kind: "minutes_table" },
  });
  if (existing && existing.source === "user" && !confirmReplace) {
    return NextResponse.json(
      { error: "This meeting's minutes table has manual edits. Pass confirmReplace: true to regenerate and discard them." },
      { status: 409 },
    );
  }

  const segments = await prisma.transcriptSegment.findMany({
    where: { meetingId: auth.meeting.id },
    orderBy: { order: "asc" },
  });
  if (segments.length === 0) {
    return NextResponse.json({ error: "This meeting has no transcript yet" }, { status: 400 });
  }

  const insights = await generateMeetingInsights({
    meetingTitle: auth.meeting.title,
    transcript: segments.map((s) => ({ speaker: s.speakerKey, text: s.textEn ?? s.textVi ?? "" })),
    callerEmail: auth.email,
    outputLanguage,
  });

  const items = buildMinutesTableItems(insights?.minutes ?? [], segments.map((s) => s.id));

  const data = {
    kind: "minutes_table",
    title: existing?.title || DEFAULT_SECTION_TITLES.minutes_table,
    source: "ai",
    items: items as unknown as Prisma.InputJsonValue,
  };

  let saveResult: { saved: NonNullable<typeof existing> } | { conflict: true };
  try {
    saveResult = await prisma.$transaction(
      async (tx) => {
        const current = await tx.meetingOverviewSection.findFirst({
          where: { summaryId: auth.summary.id, kind: "minutes_table" },
        });

        // AI generation can take long enough for a second editor to change,
        // delete, or create this section. Never replace a version different
        // from the one the caller confirmed against at request start.
        if (existing ? !current || current.id !== existing.id : Boolean(current)) {
          return { conflict: true as const };
        }
        if (existing && current && current.updatedAt.getTime() !== existing.updatedAt.getTime()) {
          return { conflict: true as const };
        }
        if (current?.source === "user" && !confirmReplace) {
          return { conflict: true as const };
        }

        if (current) {
          const update = await tx.meetingOverviewSection.updateMany({
            where: { id: current.id, updatedAt: current.updatedAt },
            data,
          });
          if (update.count !== 1) return { conflict: true as const };
          const saved = await tx.meetingOverviewSection.findUnique({ where: { id: current.id } });
          return saved ? { saved } : { conflict: true as const };
        }

        const last = await tx.meetingOverviewSection.findFirst({
          where: { summaryId: auth.summary.id },
          orderBy: { order: "desc" },
        });
        const saved = await tx.meetingOverviewSection.create({
          data: {
            ...data,
            summaryId: auth.summary.id,
            order: (last?.order ?? -1) + 1,
          },
        });
        return { saved };
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2034") {
      saveResult = { conflict: true };
    } else {
      throw error;
    }
  }

  if ("conflict" in saveResult) {
    return NextResponse.json(
      { error: "The minutes table changed while AI was generating. Reload and try again." },
      { status: 409 },
    );
  }

  return NextResponse.json(serializeOverviewSection(saveResult.saved));
}
