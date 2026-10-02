/**
 * lib/meeting/ai/meetingSectionAgent.ts
 *
 * Network half of "Generate with AI" for one Overview section (see
 * lib/meeting/sectionGeneration.ts for the prompt/parse/merge logic): asks the
 * shared chat agent for items of one kind, chunking a long transcript.
 */

import { callChatAgent } from "./difyClient";
import { chunkByCharBudget, runWithConcurrency } from "./batchLines";
import { buildSectionQuery, parseGeneratedItems } from "../sectionGeneration";
import type { OverviewSectionKind, SectionItem } from "../overviewSections";

const MAX_CHUNK_CHARS = 12_000;
const MAX_CONCURRENT_CHUNKS = 3;

export interface SectionTranscriptLine {
  segmentId: string;
  speaker: string;
  text: string;
}

/** Returns the generated items (possibly empty), or `null` when the AI could
 *  not be reached for any chunk. */
export async function generateSectionItems(options: {
  kind: OverviewSectionKind;
  sectionTitle: string;
  meetingTitle: string;
  transcript: SectionTranscriptLine[];
  existing: SectionItem[];
  callerEmail: string;
  outputLanguage?: string;
}): Promise<SectionItem[] | null> {
  const chunks = chunkByCharBudget(options.transcript, (l) => `[${l.speaker}] ${l.text}`, MAX_CHUNK_CHARS);
  const isPartial = chunks.length > 1;
  const stamp = Date.now().toString(36);

  const perChunk = await runWithConcurrency(chunks, MAX_CONCURRENT_CHUNKS, async (lines, chunkIndex) => {
    const numbered = lines.map((l, i) => `[${i}] [${l.speaker}] ${l.text}`).join("\n");
    const query = buildSectionQuery({
      kind: options.kind,
      sectionTitle: options.sectionTitle,
      meetingTitle: options.meetingTitle,
      numberedTranscript: numbered,
      existing: options.existing,
      isPartial,
      outputLanguage: options.outputLanguage,
    });
    const raw = (await callChatAgent(query, options.callerEmail)) ?? (await callChatAgent(query, options.callerEmail));
    if (raw === null) return null;
    return parseGeneratedItems(options.kind, raw, lines.map((l) => l.segmentId), `ai_${options.kind}_${stamp}_${chunkIndex}`);
  });

  if (perChunk.every((r) => r === null || r === undefined)) return null;
  return perChunk.flatMap((r) => r ?? []);
}
