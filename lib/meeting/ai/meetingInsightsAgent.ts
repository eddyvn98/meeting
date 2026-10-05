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
import { chunkByCharBudget, runWithConcurrency } from "./batchLines";
import { callProcessingWorkflow, type MeetingProcessingFeature } from "./processingWorkflow";

export interface MeetingAgentTranscriptLine {
  speaker: string;
  text: string;
  timestampMs?: number;
}

const MAX_TRANSCRIPT_CHARS = 12_000;
const MAX_CONCURRENT_BATCHES = 4;
const INSIGHTS_LEGACY_KEYS = ["MEETING_INSIGHTS_WORKFLOW_KEY", "INSIGHTS_WORKFLOW_KEY", "DIFY_INSIGHTS_API_KEY"];
const INSIGHTS_LEGACY_URLS = ["MEETING_INSIGHTS_WORKFLOW_URL", "INSIGHTS_WORKFLOW_URL", "DIFY_INSIGHTS_API_URL"];

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
  outputLanguage: string | undefined,
  usageFeature: MeetingProcessingFeature,
): Promise<string> {
  const query = [
    `These are separate summaries of consecutive parts of one meeting (titled "${meetingTitle}"), in chronological order:`,
    "",
    overviews.map((o, i) => `Part ${i + 1}: ${o}`).join("\n"),
    "",
    `Write ONE 2-4 sentence overview of the WHOLE meeting that reads as a single coherent summary, not a list of parts. ${outputLanguage ? `Write it in ${outputLanguage}.` : "Write it in the same predominant language as the input summaries above."} Reply with ONLY that prose, no preamble.`,
  ].join("\n");
  const raw = await callProcessingWorkflow({
    feature: usageFeature,
    callerEmail,
    legacyKeyEnvNames: INSIGHTS_LEGACY_KEYS,
    legacyUrlEnvNames: INSIGHTS_LEGACY_URLS,
    inputs: {
      task: "consolidate_overviews",
      meeting_title: meetingTitle,
      overviews_json: JSON.stringify(overviews),
      output_language: outputLanguage ?? "",
    },
  });
  return raw?.trim() || overviews.join("\n\n");
}

export async function generateMeetingInsights(options: {
  meetingTitle: string;
  transcript: MeetingAgentTranscriptLine[];
  callerEmail: string;
  /** Human-readable language name (e.g. "Vietnamese") the generated text
   *  must be written in; omit to follow the transcript's own language. */
  outputLanguage?: string;
  /** Usage/fallback policy label for callers such as summary or minutes. */
  usageFeature?: "insights" | "summary" | "minutes";
}): Promise<ParsedMeetingInsights | null> {
  const { transcript, meetingTitle, callerEmail, outputLanguage } = options;
  const usageFeature = options.usageFeature ?? "insights";
  if (transcript.length === 0) return null;

  const chunks = chunkByCharBudget(transcript, (line) => `[${line.speaker}] ${line.text}`, MAX_TRANSCRIPT_CHARS);
  const perChunk = await runWithConcurrency(chunks, MAX_CONCURRENT_BATCHES, async (chunkSegments) => {
    const numbered = chunkSegments.map((segment, i) => `[${i}] [${segment.speaker}] ${segment.text}`).join("\n");
    const raw = await callProcessingWorkflow({
      feature: usageFeature,
      callerEmail,
      legacyKeyEnvNames: INSIGHTS_LEGACY_KEYS,
      legacyUrlEnvNames: INSIGHTS_LEGACY_URLS,
      signal: AbortSignal.timeout(35_000),
      inputs: {
        task: "insights",
        meeting_title: meetingTitle,
        transcript: numbered,
        output_language: outputLanguage ?? "",
      },
    });

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

  const overview = merged.overviews.length <= 1 ? (merged.overviews[0] ?? "") : await consolidateOverviews(meetingTitle, merged.overviews, callerEmail, outputLanguage, usageFeature);

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
