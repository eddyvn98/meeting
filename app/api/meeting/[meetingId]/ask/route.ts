import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { resolveMeetingAccess } from "../../_access";
import { askMeetingAgent } from "@/lib/meeting/ai/difyMeetingAgent";
import { glossaryContextBlock } from "@/lib/meeting/glossary/applyGlossary";

// Mirrors translate-live/route.ts's MAX_TEXT_LENGTH guard — an unbounded
// question inflates the prompt size/cost sent to the LLM for no UI benefit
// (nobody types a multi-thousand-character question by hand).
const MAX_QUESTION_LENGTH = 4_000;

/**
 * POST /api/meeting/[meetingId]/ask — "Ask this meeting" Q&A.
 *
 * Uses the dedicated Meeting workflow (lib/meeting/ai/difyMeetingAgent.ts), giving it
 * the meeting's transcript (each line timestamped) plus the caller-supplied
 * `history` of earlier turns in this conversation as inline context, so the
 * Ask tab can behave like a normal continuous chat instead of one-shot Q&A —
 * see MeetingAskTab.tsx, which keeps that history client-side and resends it
 * with every new question. If the Meeting workflow isn't configured,
 * or the upstream call fails, falls back to a naive case-insensitive keyword match over the transcript
 * text and a templated placeholder answer, so the tab still returns
 * something usable offline/in dev. Evidence timestamps (matched transcript
 * segments) are computed either way and are always real, regardless of
 * which path answered — only `mocked` distinguishes a real agent answer from
 * the keyword-search fallback (see MeetingAskAnswerCard's "Preview answer"
 * badge, shown only when `mocked` is true).
 *
 * Available to the owner AND anyone with an active MeetingShare grant (see
 * _access.ts) — a shared viewer gets their own Ask conversation, never the
 * owner's: `history` always comes from the CALLER's own client state
 * (MeetingAskTab.tsx), never persisted or shared server-side at all.
 */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  const accessRole = meeting ? await resolveMeetingAccess(meeting, email) : null;
  if (!meeting || !accessRole) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { question?: string; history?: { question?: string; answer?: string }[] };
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

  const history = Array.isArray(body.history)
    ? body.history
        .filter((t): t is { question: string; answer: string } => typeof t?.question === "string" && typeof t?.answer === "string")
        // Only the last few turns — the transcript itself already carries the
        // real context, this is just enough to resolve a follow-up question.
        .slice(-6)
    : [];

  const segments = await prisma.transcriptSegment.findMany({
    where: { meetingId: meeting.id },
    orderBy: { order: "asc" },
  });

  const keywords = question
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const matches = segments
    .filter((s) => {
      const text = `${s.textEn ?? ""} ${s.textVi ?? ""}`.toLowerCase();
      return keywords.length === 0 || keywords.some((k) => text.includes(k));
    })
    .slice(0, 5);

  const evidence = matches.map((s) => ({
    segmentId: s.id,
    timestampMs: s.startTimeMs,
    quote: (s.textEn ?? s.textVi ?? "").slice(0, 140),
  }));

  const ownerGlossary = await prisma.meetingGlossaryTerm.findMany({ where: { ownerEmail: meeting.ownerEmail } });

  const agentResult = await askMeetingAgent({
    meetingId: meeting.id,
    meetingTitle: meeting.title,
    question,
    transcript: segments.map((s) => ({ speaker: s.speakerKey, text: s.textEn ?? s.textVi ?? "", timestampMs: s.startTimeMs })),
    callerEmail: email,
    history,
    glossaryBlock: glossaryContextBlock(ownerGlossary),
  });
  if (agentResult) {
    return NextResponse.json({ question, answer: agentResult.answer, evidence, mocked: false });
  }

  const answer =
    evidence.length > 0
      ? `Preview answer (no LLM wired up yet): found ${evidence.length} transcript moment(s) mentioning words from your question. Review the evidence below.`
      : `Preview answer (no LLM wired up yet): no transcript moments matched keywords from your question.`;

  return NextResponse.json({ question, answer, evidence, mocked: true });
}
