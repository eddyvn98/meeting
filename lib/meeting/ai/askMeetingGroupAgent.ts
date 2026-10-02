/**
 * lib/meeting/ai/askMeetingGroupAgent.ts
 *
 * "Ask across this group" — the group page's aggregate Q&A (see
 * app/api/meeting/groups/[groupId]/ask/route.ts and
 * MeetingGroupAskPanel.tsx). Same shared CHAT_KEY agent as
 * difyMeetingAgent.ts's askMeetingAgent, but fed a SEPARATE transcript
 * excerpt per selected meeting instead of one meeting's whole transcript —
 * the caller ticks which meetings in the group to include, so this never
 * silently pulls in every meeting a folder has ever collected.
 */

import { callChatAgent, formatLine, selectRelevantLines, type MeetingAgentTranscriptLine, type MeetingAgentConversationTurn } from "./difyMeetingAgent";

/** Per-meeting transcript budget. Kept well under askMeetingAgent's
 *  single-meeting MAX_TRANSCRIPT_CHARS (12,000) since a group question
 *  typically spans several meetings at once — the combined prompt still
 *  needs to fit in one call. */
const PER_MEETING_CHAR_BUDGET = 4_000;

export interface MeetingGroupAgentMeeting {
  meetingId: string;
  meetingTitle: string;
  transcript: MeetingAgentTranscriptLine[];
}

export async function askMeetingGroupAgent(options: {
  groupName: string;
  question: string;
  meetings: MeetingGroupAgentMeeting[];
  callerEmail: string;
  /** Prior turns in this group's Ask conversation, oldest first — same
   *  follow-up-resolution role as askMeetingAgent's `history`. */
  history?: MeetingAgentConversationTurn[];
  glossaryBlock?: string | null;
}): Promise<{ answer: string } | null> {
  const keywordSource = [options.question, ...(options.history ?? []).slice(-2).map((t) => t.question)].join(" ");
  const keywords = keywordSource
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3);

  const meetingBlocks = options.meetings.map((m) => {
    const lines = selectRelevantLines(m.transcript, keywords, PER_MEETING_CHAR_BUDGET);
    const body = lines.length > 0 ? lines.map(formatLine).join("\n") : "(no transcript)";
    return `### Meeting: "${m.meetingTitle}"\n${body}`;
  });

  const historyBlock =
    options.history && options.history.length > 0
      ? `\n\nEarlier in this conversation:\n${options.history.map((t) => `Q: ${t.question}\nA: ${t.answer}`).join("\n")}`
      : "";
  const glossaryBlock = options.glossaryBlock ? `\n\n${options.glossaryBlock}` : "";

  if (meetingBlocks.length === 0) {
    return null;
  }

  const query = `You are answering questions about a GROUP of related meetings, filed together under the folder "${options.groupName}", in an ongoing conversation. Below are excerpts from ${meetingBlocks.length} meeting(s) in this folder, each under its own "### Meeting" heading — treat them as separate meetings and say which meeting(s) each part of your answer comes from. Use ONLY the excerpts below as source of truth; if the answer isn't in them, say so explicitly instead of guessing.${glossaryBlock}\n\n${meetingBlocks.join("\n\n")}${historyBlock}\n\nQuestion: ${options.question}`;

  const answer = await callChatAgent(query, options.callerEmail);
  return answer ? { answer } : null;
}
