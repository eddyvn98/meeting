/**
 * lib/meeting/ai/deepseekTranslate.ts
 *
 * Translation engine powered by the shared Dify workflow.
 * Single-segment translation uses Qwen3.6 Flash first and retries with Qwen-MT
 * Turbo when the fast path fails. Batch translation uses the same single-segment
 * fallback only for lines left unresolved by its dedicated batch path.
 * Designed for low-latency live translation and resilient batch translation.
 */

import { callChatAgent, callWorkflowApp } from "./difyMeetingAgent";
import { resolveWorkflowConfig } from "./difyClient";

const DEFAULT_CALLER_EMAIL = "system@meeting.local";
const LIVE_PRIMARY_TIMEOUT_MS = 3_000;
const LIVE_FALLBACK_TIMEOUT_MS = 4_000;

export type LiveTranslationProvider = "qwen3.6-flash" | "qwen-mt-turbo" | "legacy-chat";

export interface LiveTranslationResult {
  text: string;
  provider: LiveTranslationProvider;
  elapsedMs: number;
  attempts: number;
}

function getTranslationWorkflowConfig(): { key: string; url: string } | null {
  return resolveWorkflowConfig(
    ["MEETING_AI_KEY", "TRANSLATION_WORKFLOW_KEY", "DIFY_TRANSLATION_API_KEY"],
    ["MEETING_AI_URL", "TRANSLATION_WORKFLOW_URL", "DIFY_TRANSLATION_API_URL"],
  );
}

/**
 * Translates a single text segment with low latency.
 * Ideal for live subtitles/captions during recording.
 * Returns null if translation could not be completed.
 */
export async function translateSingleSegmentFastDetailed(
  text: string,
  targetLanguage: string,
  callerEmail?: string,
): Promise<LiveTranslationResult | null> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { text: "", provider: "qwen3.6-flash", elapsedMs: 0, attempts: 0 };
  }

  const user = callerEmail || process.env.NEXT_PUBLIC_DEV_USER_EMAIL || DEFAULT_CALLER_EMAIL;
  const startedAt = Date.now();
  const wfConfig = getTranslationWorkflowConfig();

  // Primary: Qwen3.6 Flash. The workflow maps task=translate to this node.
  if (wfConfig) {
    try {
      const wfResult = await callWorkflowApp(
        { task: "translate", text: trimmed, target_language: targetLanguage },
        user,
        wfConfig.key,
        wfConfig.url,
        AbortSignal.timeout(LIVE_PRIMARY_TIMEOUT_MS),
      );
      if (wfResult?.trim()) {
        return {
          text: wfResult.trim(),
          provider: "qwen3.6-flash",
          elapsedMs: Date.now() - startedAt,
          attempts: 1,
        };
      }
    } catch (error) {
      console.warn("[meeting] Qwen3.6 Flash live translation failed:", error);
    }

    // Fallback: Qwen-MT Turbo. This is a separate workflow branch in the same
    // Dify app, so it uses the same credentials and remains cheap/fast.
    try {
      const wfResult = await callWorkflowApp(
        { task: "translate_turbo", text: trimmed, target_language: targetLanguage },
        user,
        wfConfig.key,
        wfConfig.url,
        AbortSignal.timeout(LIVE_FALLBACK_TIMEOUT_MS),
      );
      if (wfResult?.trim()) {
        return {
          text: wfResult.trim(),
          provider: "qwen-mt-turbo",
          elapsedMs: Date.now() - startedAt,
          attempts: 2,
        };
      }
    } catch (error) {
      console.warn("[meeting] Qwen-MT Turbo live translation failed:", error);
    }
  }

  // Last-resort compatibility path for deployments that have not yet imported
  // the dual-model workflow. It preserves the old behavior without changing
  // the normal live path once the upgraded DSL is active.
  const prompt = `You are a real-time speech translator. Translate the following text directly into natural ${targetLanguage}. Reply with ONLY the direct translation, with no quotes, explanations, markdown formatting, or altered punctuation:\n\n${trimmed}`;

  try {
    const result = await callChatAgent(
      prompt,
      user,
      undefined,
      AbortSignal.timeout(10_000),
    );
    if (result?.trim()) {
      return {
        text: result.trim(),
        provider: "legacy-chat",
        elapsedMs: Date.now() - startedAt,
        attempts: wfConfig ? 3 : 1,
      };
    }

    const fallbackResult = await callChatAgent(
      prompt,
      user,
      { model_selector: "deepseek-v4-flash" },
      AbortSignal.timeout(15_000),
    );
    if (fallbackResult?.trim()) {
      return {
        text: fallbackResult.trim(),
        provider: "legacy-chat",
        elapsedMs: Date.now() - startedAt,
        attempts: wfConfig ? 4 : 2,
      };
    }
  } catch (err) {
    console.warn("[meeting] Fast live translation via CHAT_KEY failed:", err);
  }

  return null;
}

export async function translateSingleSegmentFast(
  text: string,
  targetLanguage: string,
  callerEmail?: string,
): Promise<string | null> {
  const result = await translateSingleSegmentFastDetailed(text, targetLanguage, callerEmail);
  return result?.text ?? null;
}

/**
 * Translates multiple lines in a single fast prompt.
 */
export async function translateBatchFast(
  lines: string[],
  targetLanguage: string,
  callerEmail?: string,
): Promise<(string | null)[]> {
  if (lines.length === 0) return [];

  const user = callerEmail || process.env.NEXT_PUBLIC_DEV_USER_EMAIL || DEFAULT_CALLER_EMAIL;

  // 1. Dedicated workflow: bounded parallel execution
  const wfConfig = getTranslationWorkflowConfig();
  const results: (string | null)[] = new Array(lines.length).fill(null);
  if (wfConfig) {
    const BATCH_SIZE = 5;
    for (let i = 0; i < lines.length; i += BATCH_SIZE) {
      const chunk = lines.slice(i, i + BATCH_SIZE);
      const chunkResults = await Promise.all(
        chunk.map((line) =>
          callWorkflowApp(
            { task: "translate", text: line.trim(), target_language: targetLanguage },
            user,
            wfConfig.key,
            wfConfig.url,
            AbortSignal.timeout(10_000),
          )
        )
      );
      chunkResults.forEach((r, j) => {
        results[i + j] = r;
      });
    }
    if (results.every((r) => r !== null)) {
      return results;
    }
  }

  // Only the lines the workflow attempt above left null need a fallback —
  // a workflow that translated most lines successfully shouldn't have that
  // work thrown away (and be re-sent upstream) just because a few lines in
  // the same batch failed/timed out.
  const missingIndices = results.reduce<number[]>((acc, r, i) => {
    if (r === null) acc.push(i);
    return acc;
  }, []);
  const missingLines = missingIndices.map((i) => lines[i]);

  // 2. Fallback path: single batch prompt to chat agent
  const numbered = missingLines.map((l, i) => `[${i}] ${l}`).join("\n");
  const prompt = `Translate each of the numbered lines into natural ${targetLanguage}. Reply with ONLY a valid JSON array of strings in exact order: ["translated line 0", "translated line 1", ...]. Do not include markdown code fences or explanations:\n\n${numbered}`;

  try {
    const raw = await callChatAgent(
      prompt,
      user,
      { model_selector: "deepseek-v4-flash" },
      AbortSignal.timeout(20_000),
    );

    if (raw) {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length === missingLines.length) {
        missingIndices.forEach((idx, j) => {
          const item = parsed[j];
          results[idx] = typeof item === "string" ? item.trim() : null;
        });
        return results;
      }
      if (Array.isArray(parsed)) {
        console.warn(`[meeting] Fast batch translation length mismatch: expected ${missingLines.length}, got ${parsed.length}`);
      }
    }
  } catch (err) {
    console.warn("[meeting] Fast batch translation via CHAT_KEY failed, falling back to individual calls:", err);
  }

  // Fallback: bounded concurrency of 3 to avoid overwhelming upstream agent
  const BATCH_SIZE = 3;
  for (let i = 0; i < missingIndices.length; i += BATCH_SIZE) {
    const idxChunk = missingIndices.slice(i, i + BATCH_SIZE);
    const chunkResults = await Promise.all(
      idxChunk.map((idx) => translateSingleSegmentFast(lines[idx], targetLanguage, user))
    );
    idxChunk.forEach((idx, j) => {
      results[idx] = chunkResults[j];
    });
  }
  return results;
}
