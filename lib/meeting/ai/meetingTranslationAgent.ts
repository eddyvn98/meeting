/**
 * lib/meeting/ai/meetingTranslationAgent.ts
 *
 * Full-transcript translation pipeline using the shared CHAT_KEY Dify agent.
 * Handles batching, concurrency limits, and bisection retries.
 */

import { parseTranslations } from "./meetingTranslationParser";
import { chunkByCharBudget, runWithConcurrency } from "./batchLines";
import { callChatAgent, callWorkflowApp, resolveWorkflowConfig } from "./difyClient";

const TRANSLATION_CHUNK_CHARS = 3_000;
const MAX_CONCURRENT_BATCHES = 4;

function getTranslationWorkflowConfig(): { key: string; url: string } | null {
  return resolveWorkflowConfig(
    ["MEETING_AI_KEY", "TRANSLATION_WORKFLOW_KEY", "DIFY_TRANSLATION_API_KEY"],
    ["MEETING_AI_URL", "TRANSLATION_WORKFLOW_URL", "DIFY_TRANSLATION_API_URL"],
  );
}

export function buildTranslationQuery(
  lines: string[],
  targetLanguageLabel: string,
  glossaryBlock?: string | null,
): string {
  const numbered = lines.map((text, i) => `[${i}] ${text}`).join("\n");

  return [
    `Translate each of the following ${lines.length} numbered English lines into natural ${targetLanguageLabel}.`,
    `Reply with ONLY a JSON array of ${lines.length} strings (no markdown fence, no prose), in the exact same order — translation for line [0] first, then [1], and so on. Do not merge, skip, or reorder lines.`,
    ...(glossaryBlock ? ["", glossaryBlock] : []),
    "",
    numbered,
  ].join("\n");
}

/**
 * Translates every line into `targetLanguageLabel`.
 * Splits lines into TRANSLATION_CHUNK_CHARS batches and translates them concurrently.
 */
export async function generateTranslations(
  lines: string[],
  targetLanguageLabel: string,
  callerEmail: string,
  glossaryBlock?: string | null,
): Promise<(string | null)[] | null> {
  if (lines.length === 0) return null;

  async function translateChunk(chunkLines: string[], allowBisect: boolean): Promise<(string | null)[] | null> {
    const wfConfig = getTranslationWorkflowConfig();
    let raw: string | null = null;

    if (wfConfig) {
      try {
        const numbered = chunkLines.map((text, i) => `[${i}] ${text}`).join("\n");
        raw = await callWorkflowApp(
          {
            task: "translate_batch",
            text: numbered,
            target_language: targetLanguageLabel,
          },
          callerEmail,
          wfConfig.key,
          wfConfig.url,
          AbortSignal.timeout(20_000),
        );
      } catch (err) {
        console.warn("[meeting] Fast batch translation workflow failed, falling back to chat agent:", err);
      }
    }

    if (!raw) {
      const query = buildTranslationQuery(chunkLines, targetLanguageLabel, glossaryBlock);
      raw = await callChatAgent(query, callerEmail);
    }

    const parsed = raw ? parseTranslations(raw, chunkLines.length) : null;
    if (parsed || !allowBisect || chunkLines.length < 2) return parsed;

    const mid = Math.ceil(chunkLines.length / 2);
    const [left, right] = await Promise.all([
      translateChunk(chunkLines.slice(0, mid), false),
      translateChunk(chunkLines.slice(mid), false),
    ]);
    if (!left && !right) return null;
    return [...(left ?? chunkLines.slice(0, mid).map(() => null)), ...(right ?? chunkLines.slice(mid).map(() => null))];
  }

  const chunks = chunkByCharBudget(lines, (line) => line, TRANSLATION_CHUNK_CHARS);
  const perChunk = await runWithConcurrency(chunks, MAX_CONCURRENT_BATCHES, (chunkLines) => translateChunk(chunkLines, true));

  if (perChunk.every((r) => r === null)) return null;
  return perChunk.flatMap((result, i) => result ?? chunks[i].map(() => null));
}
