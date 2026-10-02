import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMeetingEditor } from "../../sections/_shared";
import { generateMeetingInsights } from "@/lib/meeting/ai/meetingInsightsAgent";
import { resolveOutputLanguage } from "@/lib/meeting/outputLanguage";
import { serializeMeetingSummary } from "@/lib/meeting/serialize";

type RegenerateTarget = "summary" | "timeline";

function evidenceIds(index: number | null, segmentIds: string[]): string[] {
  if (index === null) return [];
  const id = segmentIds[index];
  return id ? [id] : [];
}

/**
 * POST /api/meeting/[meetingId]/summary/generate
 *
 * Rebuilds exactly one top-level Overview artifact from the saved transcript:
 * - target="summary": replaces only MeetingSummary.overview.
 * - target="timeline": replaces only Topic rows (the Timeline card).
 *
 * Dynamic Overview sections are deliberately untouched. This gives an
 * owner/editor a recovery action after a bad manual edit without resetting
 * the rest of the Overview page.
 */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const auth = await requireMeetingEditor(req, params.meetingId);
  if (!auth.ok) return auth.response;

  let body: { target?: unknown; language?: unknown } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const target = body.target;
  if (target !== "summary" && target !== "timeline") {
    return NextResponse.json({ error: "target must be summary or timeline" }, { status: 400 });
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

  const insights = await generateMeetingInsights({
    meetingTitle: auth.meeting.title,
    transcript: segments.map((segment) => ({
      speaker: segment.speakerKey,
      text: segment.textEn ?? segment.textVi ?? "",
      timestampMs: segment.startTimeMs,
    })),
    callerEmail: auth.email,
    outputLanguage: language.label,
  });

  if (!insights) {
    return NextResponse.json({ error: "The AI could not generate meeting insights. Please try again." }, { status: 502 });
  }

  const segmentIds = segments.map((segment) => segment.id);

  if (target === "summary") {
    const overview = insights.overview.trim();
    if (!overview) {
      return NextResponse.json({ error: "The AI did not produce a summary for this transcript." }, { status: 422 });
    }
    await prisma.meetingSummary.update({
      where: { id: auth.summary.id },
      data: { overview },
    });
  } else {
    // A failed/empty AI extraction must not erase a timeline that was already
    // there. Only replace the current topics after we have a non-empty result.
    if (insights.topics.length === 0) {
      return NextResponse.json({ error: "The AI did not find enough grounded topics to rebuild the timeline." }, { status: 422 });
    }
    await prisma.$transaction(async (tx) => {
      await tx.topic.deleteMany({ where: { summaryId: auth.summary.id } });
      await tx.topic.createMany({
        data: insights.topics.map((topic, order) => ({
          summaryId: auth.summary.id,
          title: topic.title,
          evidenceSegmentIds: evidenceIds(topic.evidenceIndex, segmentIds),
          order,
        })),
      });
    });
  }

  const updated = await prisma.meetingSummary.findUnique({
    where: { id: auth.summary.id },
    include: {
      topics: true,
      decisions: true,
      actionItems: true,
      blockers: true,
      openQuestions: true,
      sections: { orderBy: { order: "asc" } },
    },
  });
  if (!updated) return NextResponse.json({ error: "Summary not found" }, { status: 404 });

  return NextResponse.json({
    summary: serializeMeetingSummary(updated),
    target: target as RegenerateTarget,
    generatedCount: target === "timeline" ? updated.topics.length : 1,
  });
}
