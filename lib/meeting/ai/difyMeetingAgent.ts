/**
 * lib/meeting/ai/difyMeetingAgent.ts
 *
 * Facade for Meeting AI features backed by the dedicated MEETING_AI_KEY workflow.
 */

import { callChatAgent, callWorkflowApp, extractAnswer } from "./difyClient";
import {
  generateMeetingInsights,
  type MeetingAgentTranscriptLine,
} from "./meetingInsightsAgent";
import {
  generateTranslations,
  buildTranslationQuery,
} from "./meetingTranslationAgent";

export {
  callChatAgent,
  callWorkflowApp,
  extractAnswer,
  generateMeetingInsights,
  generateTranslations,
  buildTranslationQuery,
  type MeetingAgentTranscriptLine,
};

const MAX_TRANSCRIPT_CHARS = 12_000;

export interface MeetingAgentConversationTurn {
  question: string;
  answer: string;
}

export function formatClockForAgent(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatLine(l: MeetingAgentTranscriptLine): string {
  const time = typeof l.timestampMs === "number" ? `[${formatClockForAgent(l.timestampMs)}] ` : "";
  return `${time}[${l.speaker}] ${l.text}`;
}

/**
 * Selects the transcript lines most relevant to keywords within budgetChars.
 * Falls back to evenly-spaced sampling across the whole meeting when nothing scores above zero.
 */
export function selectRelevantLines(
  lines: MeetingAgentTranscriptLine[],
  keywords: string[],
  budgetChars: number,
): MeetingAgentTranscriptLine[] {
  const scored = lines.map((line, index) => {
    const text = line.text.toLowerCase();
    const score = keywords.reduce((sum, kw) => sum + (text.includes(kw) ? 1 : 0), 0);
    return { line, index, score };
  });

  const anyScored = scored.some((s) => s.score > 0);
  const ranked = anyScored
    ? [...scored].sort((a, b) => b.score - a.score || a.index - b.index)
    : scored.filter((_, i) => i % Math.max(1, Math.ceil(lines.length / 400)) === 0);

  const selected: typeof scored = [];
  let chars = 0;
  for (const item of ranked) {
    const len = formatLine(item.line).length + 1;
    if (selected.length > 0 && chars + len > budgetChars) break;
    selected.push(item);
    chars += len;
  }

  return selected.sort((a, b) => a.index - b.index).map((s) => s.line);
}

function buildTranscriptBlock(lines: MeetingAgentTranscriptLine[], keywords: string[] = []): string {
  const joined = lines.map(formatLine).join("\n");
  if (joined.length <= MAX_TRANSCRIPT_CHARS) return joined;

  const selected = selectRelevantLines(lines, keywords, MAX_TRANSCRIPT_CHARS);
  const note = `[This meeting is long — showing the ${selected.length} of ${lines.length} transcript lines most relevant to the question below, not the full transcript.]`;
  return `${note}\n${selected.map(formatLine).join("\n")}`;
}

export async function askMeetingAgent(options: {
  meetingId: string;
  meetingTitle: string;
  question: string;
  transcript: MeetingAgentTranscriptLine[];
  callerEmail: string;
  history?: MeetingAgentConversationTurn[];
  glossaryBlock?: string | null;
}): Promise<{ answer: string } | null> {
  const keywordSource = [options.question, ...(options.history ?? []).slice(-2).map((t) => t.question)].join(" ");
  const keywords = keywordSource
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3);

  const transcriptBlock = buildTranscriptBlock(options.transcript, keywords);
  const historyBlock =
    options.history && options.history.length > 0
      ? `\n\nEarlier in this conversation:\n${options.history
          .map((t) => `Q: ${t.question}\nA: ${t.answer}`)
          .join("\n")}`
      : "";
  const glossaryBlock = options.glossaryBlock ? `\n\n${options.glossaryBlock}` : "";

  const query = transcriptBlock
    ? `You are answering questions about a meeting titled "${options.meetingTitle}" in an ongoing conversation. Use ONLY the transcript below as source of truth; if the answer isn't in it, say so explicitly instead of guessing. Each transcript line starts with its timestamp as [MM:SS] — use those to answer questions about a specific time/moment in the meeting.${glossaryBlock}\n\nTranscript:\n${transcriptBlock}${historyBlock}\n\nQuestion: ${options.question}`
    : `The meeting titled "${options.meetingTitle}" has no transcript yet. Politely say there is nothing to answer from yet.\n\nQuestion: ${options.question}`;

  const answer = await callChatAgent(
    query,
    options.callerEmail,
    undefined,
    AbortSignal.timeout(25_000),
    "ask_meeting",
  );

  return answer ? { answer } : null;
}
