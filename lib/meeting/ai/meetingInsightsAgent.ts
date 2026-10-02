/**
 * lib/meeting/ai/meetingInsightsAgent.ts
 *
 * Generates structured meeting insights (overview, topics, AI-chosen sections,
 * action items, blockers, suggested title) from transcript lines using
 * the shared CHAT_KEY Dify agent.
 */

import {
  parseMeetingInsights,
  type ParsedMeetingInsights,
  type ParsedInsightItem,
  type ParsedTopic,
  type ParsedActionItem,
  type ParsedMinutesMatter,
  type ParsedSection,
  mergeParsedSections,
} from "./meetingInsightsParser";
import { describeSectionKindsForPrompt } from "../sectionGeneration";
import { chunkByCharBudget, runWithConcurrency } from "./batchLines";
import { callChatAgent, callWorkflowApp, resolveWorkflowConfig } from "./difyClient";

export interface MeetingAgentTranscriptLine {
  speaker: string;
  text: string;
  timestampMs?: number;
}

const MAX_TRANSCRIPT_CHARS = 12_000;
const MAX_CONCURRENT_BATCHES = 4;

function buildInsightsQuery(
  meetingTitle: string,
  segments: MeetingAgentTranscriptLine[],
  isPartial: boolean,
  outputLanguage?: string,
): string {
  const numbered = segments.map((s, i) => `[${i}] [${s.speaker}] ${s.text}`).join("\n");
  const partialNote = isPartial
    ? ` This is one chunk of a longer meeting transcript — only analyze what's shown below, do not assume anything about parts you can't see.`
    : "";

  return [
    `Analyze this meeting transcript (titled "${meetingTitle}").${partialNote} Each line is prefixed with its 0-based index in brackets, e.g. "[3]".`,
    `Reply with ONLY a single JSON object (no markdown fence, no prose before or after) matching exactly this shape:`,
    `{"overview": "2-4 plain sentences summarizing what was discussed and any conclusions",`,
    ` "suggestedTitle": "3-6 word descriptive title for this meeting based on its actual content, or null if the transcript is too short/unclear/generic (e.g. small talk, a mic test, silence) to title confidently",`,
    ` "topics": [{"title": "short topic name", "evidenceIndex": 0}],`,
    ` "sections": [{"kind": "one kind from the list below", "title": "short section title", "items": [ ...items in that kind's shape... ]}],`,
    ` "minutes": [{"title": "short name of the matter/topic discussed", "rows": [{"discussion": ["bullet point of what was discussed"], "actions": [{"text": "what needs doing", "duration": "e.g. \\"2 weeks\\" or null", "deadline": "e.g. \\"2026-10-01\\" or null", "ongoing": false}], "responsible": ["person name"], "evidenceIndex": 0}]}]}`,
    `"sections" is the set of Overview cards for THIS meeting. YOU choose which ones to include, based on what was actually discussed — include only sections the content genuinely supports (typically 2 to 6, at most 8), in the order most useful to a reader, each kind at most once. Do not add a section just to fill space, and do not force any particular section: a brainstorm may need only "key_points" and "open_questions"; a review may need "feedback" and "actions"; a comparison of alternatives should use "options_compare"; a question-and-answer session should use "qa". Give each section a short, specific "title" (you may adapt the default name to the content). Available kinds and their item shapes:`,
    describeSectionKindsForPrompt(),
    `Keep each section to at most 8 items, grounded only in the transcript.`,
    `Use "evidenceIndex" to cite the transcript line index that best supports each topic, section item and minutes row. Provide an empty array [] for "topics", "sections" or "minutes" if there is nothing for them — do not invent items.`,
    `"minutes" is a formal Minutes-of-Meeting matters table: group the discussion into a handful of numbered matters (topics), each with one or more rows of what was discussed, what action(s) it produced, and who is responsible. Reuse names/topics already used elsewhere in your response. Leave "minutes": [] if the transcript is too short/unstructured to produce a meaningful matters table.`,
    outputLanguage
      ? `Language requirement: Write EVERY text value in your JSON response ("overview", "suggestedTitle", "topics" titles, every "sections" title and item text, and every "minutes" title/discussion/action text) in ${outputLanguage}, regardless of the language the transcript is spoken in — translate the content into ${outputLanguage} where needed. Person names in "minutes" "responsible" stay as spoken, never translated.`
      : `Language requirement: Detect the predominant language used in the provided transcript lines. All text in your JSON response ("overview", "suggestedTitle", "topics" titles, every "sections" title and item text, and every "minutes" title/discussion/action text) MUST be written in that SAME predominant language as the transcript (e.g. Vietnamese transcript -> natural Vietnamese; English transcript -> English; Japanese transcript -> Japanese). Never default to or translate into English when the transcript is primarily in another language. Person names in "minutes" "responsible" stay as spoken, never translated.`,
    "",
    "Transcript:",
    numbered,
  ].join("\n");
}

function dedupeAndCap<T>(items: T[], getKey: (item: T) => string, max = 15): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = getKey(item).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= max) break;
  }
  return result;
}

async function consolidateOverviews(
  meetingTitle: string,
  overviews: string[],
  callerEmail: string,
  outputLanguage?: string,
): Promise<string> {
  const query = [
    `These are separate summaries of consecutive parts of one meeting (titled "${meetingTitle}"), in chronological order:`,
    "",
    overviews.map((o, i) => `Part ${i + 1}: ${o}`).join("\n"),
    "",
    `Write ONE 2-4 sentence overview of the WHOLE meeting that reads as a single coherent summary, not a list of parts. ${outputLanguage ? `Write it in ${outputLanguage}.` : "Write it in the same predominant language as the input summaries above."} Reply with ONLY that prose, no preamble.`,
  ].join("\n");
  const raw = await callChatAgent(query, callerEmail);
  return raw?.trim() || overviews.join("\n\n");
}

function getInsightsWorkflowConfig(): { key: string; url: string } | null {
  return resolveWorkflowConfig(
    ["MEETING_AI_KEY", "MEETING_INSIGHTS_WORKFLOW_KEY", "INSIGHTS_WORKFLOW_KEY", "DIFY_INSIGHTS_API_KEY"],
    ["MEETING_AI_URL", "MEETING_INSIGHTS_WORKFLOW_URL", "INSIGHTS_WORKFLOW_URL", "DIFY_INSIGHTS_API_URL"],
  );
}

export async function generateMeetingInsights(options: {
  meetingTitle: string;
  transcript: MeetingAgentTranscriptLine[];
  callerEmail: string;
  /** Human-readable language name (e.g. "Vietnamese") the generated text
   *  must be written in; omit to follow the transcript's own language. */
  outputLanguage?: string;
}): Promise<ParsedMeetingInsights | null> {
  const { transcript, meetingTitle, callerEmail, outputLanguage } = options;
  if (transcript.length === 0) return null;

  const chunks = chunkByCharBudget(transcript, (line) => `[${line.speaker}] ${line.text}`, MAX_TRANSCRIPT_CHARS);
  const isPartial = chunks.length > 1;
  const wfConfig = getInsightsWorkflowConfig();

  const perChunk = await runWithConcurrency(chunks, MAX_CONCURRENT_BATCHES, async (chunkSegments) => {
    let raw: string | null = null;

    if (wfConfig) {
      try {
        const numbered = chunkSegments.map((s, i) => `[${i}] [${s.speaker}] ${s.text}`).join("\n");
        raw = await callWorkflowApp(
          {
            task: "insights",
            meeting_title: meetingTitle,
            transcript: numbered,
            output_language: outputLanguage ?? "",
          },
          callerEmail,
          wfConfig.key,
          wfConfig.url,
          AbortSignal.timeout(35_000),
        );
      } catch (err) {
        console.warn("[meeting] Fast insights workflow failed, falling back to chat agent:", err);
      }
    }

    if (!raw) {
      const query = buildInsightsQuery(meetingTitle, chunkSegments, isPartial, outputLanguage);
      raw = await callChatAgent(query, callerEmail);
      if (!raw) {
        // Retry once on transient upstream failure
        raw = await callChatAgent(query, callerEmail);
      }
    }

    return raw ? parseMeetingInsights(raw, chunkSegments.length) : null;
  });

  let globalOffset = 0;
  const sectionChunks: Array<{ sections: ParsedSection[]; offset: number }> = [];
  const merged = {
    overviews: [] as string[],
    topics: [] as ParsedTopic[],
    decisions: [] as ParsedInsightItem[],
    actionItems: [] as ParsedActionItem[],
    blockers: [] as ParsedInsightItem[],
    minutes: [] as ParsedMinutesMatter[],
    suggestedTitle: null as string | null,
  };
  const remapIndex = (idx: number | null, offset: number) => (idx === null ? null : idx + offset);
  const remapMinutesMatter = (matter: ParsedMinutesMatter, offset: number): ParsedMinutesMatter => ({
    ...matter,
    rows: matter.rows.map((row) => ({ ...row, evidenceIndex: remapIndex(row.evidenceIndex, offset) })),
  });

  chunks.forEach((chunkSegments, i) => {
    const result = perChunk[i];
    if (result) {
      if (result.overview) merged.overviews.push(result.overview);
      if (!merged.suggestedTitle && result.suggestedTitle) merged.suggestedTitle = result.suggestedTitle;
      merged.topics.push(...result.topics.map((t) => ({ ...t, evidenceIndex: remapIndex(t.evidenceIndex, globalOffset) })));
      merged.decisions.push(...result.decisions.map((d) => ({ ...d, evidenceIndex: remapIndex(d.evidenceIndex, globalOffset) })));
      merged.actionItems.push(...result.actionItems.map((a) => ({ ...a, evidenceIndex: remapIndex(a.evidenceIndex, globalOffset) })));
      merged.blockers.push(...result.blockers.map((b) => ({ ...b, evidenceIndex: remapIndex(b.evidenceIndex, globalOffset) })));
      merged.minutes.push(...result.minutes.map((m) => remapMinutesMatter(m, globalOffset)));
      sectionChunks.push({ sections: result.sections, offset: globalOffset });
    }
    globalOffset += chunkSegments.length;
  });

  if (
    merged.overviews.length === 0 &&
    merged.topics.length === 0 &&
    sectionChunks.every((c) => c.sections.length === 0) &&
    merged.decisions.length === 0 &&
    merged.actionItems.length === 0 &&
    merged.blockers.length === 0 &&
    merged.minutes.length === 0
  ) {
    return null;
  }

  const overview = merged.overviews.length <= 1 ? (merged.overviews[0] ?? "") : await consolidateOverviews(meetingTitle, merged.overviews, callerEmail, outputLanguage);

  return {
    overview,
    topics: dedupeAndCap(merged.topics, (t) => t.title),
    sections: mergeParsedSections(sectionChunks),
    decisions: dedupeAndCap(merged.decisions, (d) => d.text),
    actionItems: dedupeAndCap(merged.actionItems, (a) => a.task),
    blockers: dedupeAndCap(merged.blockers, (b) => b.text),
    minutes: dedupeAndCap(merged.minutes, (m) => m.title),
    suggestedTitle: merged.suggestedTitle,
  };
}
