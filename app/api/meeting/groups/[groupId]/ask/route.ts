import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../../_auth";
import { askMeetingGroupAgent } from "@/lib/meeting/ai/askMeetingGroupAgent";
import { glossaryContextBlock } from "@/lib/meeting/glossary/applyGlossary";

// Mirrors ask/route.ts's MAX_QUESTION_LENGTH guard.
const MAX_QUESTION_LENGTH = 4_000;
// askMeetingGroupAgent.ts bounds each meeting's own transcript slice, but
// nothing previously bounded HOW MANY meetings could be selected — a large
// enough selection still produces a combined prompt far past what's useful
// (or safe to send upstream). 50 meetings is already a generous "ask across
// a whole quarter's worth of standups" scope.
const MAX_MEETING_IDS = 50;

/**
 * POST /api/meeting/groups/[groupId]/ask — "Ask across this group" Q&A
 * (MeetingGroupAskPanel.tsx). Same shape and fallback behavior as
 * POST /api/meeting/[meetingId]/ask, except the caller ticks WHICH of the
 * group's meetings to include via `meetingIds` (never "every meeting ever
 * filed here" implicitly) and evidence citations carry which meeting they
 * came from. Groups remain personal/owner-only, but a group may contain
 * meetings shared with that owner when the recipient filed them there.
 */
export async function POST(req: NextRequest, { params }: { params: { groupId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = await prisma.meetingGroup.findUnique({ where: { id: params.groupId } });
  if (!group || group.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { question?: string; meetingIds?: unknown; history?: { question?: string; answer?: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json({ error: "question is too long" }, { status: 413 });
  }

  const meetingIds = Array.isArray(body.meetingIds) ? body.meetingIds.filter((id): id is string => typeof id === "string") : [];
  if (meetingIds.length === 0) {
    return NextResponse.json({ error: "meetingIds must include at least one meeting" }, { status: 400 });
  }
  if (meetingIds.length > MAX_MEETING_IDS) {
    return NextResponse.json({ error: `Select at most ${MAX_MEETING_IDS} meetings` }, { status: 413 });
  }

  const history = Array.isArray(body.history)
    ? body.history
        .filter((t): t is { question: string; answer: string } => typeof t?.question === "string" && typeof t?.answer === "string")
        .slice(-6)
    : [];

  const now = new Date();
  const sharedPlacements = await prisma.meetingShare.findMany({
    where: {
      meetingId: { in: meetingIds },
      groupId: group.id,
      invitedEmail: { equals: email, mode: "insensitive" },
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { meetingId: true },
  });
  const sharedMeetingIds = sharedPlacements.map((s) => s.meetingId);

  const meetings = await prisma.meeting.findMany({
    where: {
      id: { in: meetingIds },
      OR: [
        { groupId: group.id, ownerEmail: { equals: email, mode: "insensitive" } },
        { id: { in: sharedMeetingIds } },
      ],
    },
  });
  if (meetings.length === 0) {
    return NextResponse.json({ error: "None of the selected meetings belong to this group" }, { status: 400 });
  }

  const segmentsByMeeting = await Promise.all(
    meetings.map((m) => prisma.transcriptSegment.findMany({ where: { meetingId: m.id }, orderBy: { order: "asc" } })),
  );

  const keywords = question
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const evidence = meetings.flatMap((m, i) =>
    segmentsByMeeting[i]
      .filter((s) => {
        const text = `${s.textEn ?? ""} ${s.textVi ?? ""}`.toLowerCase();
        return keywords.length === 0 || keywords.some((k) => text.includes(k));
      })
      .slice(0, 3)
      .map((s) => ({
        meetingId: m.id,
        meetingTitle: m.title,
        segmentId: s.id,
        timestampMs: s.startTimeMs,
        quote: (s.textEn ?? s.textVi ?? "").slice(0, 140),
      })),
  );

  const ownerGlossary = await prisma.meetingGlossaryTerm.findMany({ where: { ownerEmail: group.ownerEmail } });

  const agentResult = await askMeetingGroupAgent({
    groupName: group.name,
    question,
    meetings: meetings.map((m, i) => ({
      meetingId: m.id,
      meetingTitle: m.title,
      transcript: segmentsByMeeting[i].map((s) => ({ speaker: s.speakerKey, text: s.textEn ?? s.textVi ?? "", timestampMs: s.startTimeMs })),
    })),
    callerEmail: email,
    history,
    glossaryBlock: glossaryContextBlock(ownerGlossary),
  });
  if (agentResult) {
    return NextResponse.json({ question, answer: agentResult.answer, evidence, mocked: false });
  }

  const answer =
    evidence.length > 0
      ? `Preview answer (no LLM wired up yet): found ${evidence.length} transcript moment(s) across ${meetings.length} meeting(s) mentioning words from your question. Review the evidence below.`
      : `Preview answer (no LLM wired up yet): no transcript moments matched keywords from your question.`;

  return NextResponse.json({ question, answer, evidence, mocked: true });
}
