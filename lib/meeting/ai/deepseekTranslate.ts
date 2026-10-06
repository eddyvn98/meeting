/**
 * Low-latency Meeting translation through the processing Dify app.
 *
 * Transport retries happen inside callWorkflowApp. Model fallback stays in
 * the same Dify app and is enabled by MEETING_DIFY_TRANSLATION_FALLBACK_ENABLED.
 */

import { callWorkflowApp } from "./difyClient";
import {
  getMeetingProcessingConfig,
  isMeetingTranslationFallbackEnabled,
} from "./processingWorkflow";

const DEFAULT_CALLER_EMAIL = "system@meeting.local";
const LIVE_MODEL_TIMEOUT_MS = 5_000;
const TRANSLATION_LEGACY_KEYS = ["TRANSLATION_WORKFLOW_KEY", "DIFY_TRANSLATION_API_KEY"];
const TRANSLATION_LEGACY_URLS = ["TRANSLATION_WORKFLOW_URL", "DIFY_TRANSLATION_API_URL"];

export type LiveTranslationProvider = string;

export interface LiveTranslationResult {
  text: string;
  provider: LiveTranslationProvider;
  elapsedMs: number;
  attempts: number;
}

function translationConfig(): { key: string; url: string } | null {
  return getMeetingProcessingConfig(TRANSLATION_LEGACY_KEYS, TRANSLATION_LEGACY_URLS);
}

function modelInputs(
  text: string,
  targetLanguage: string,
  task: "translate" | "translate_turbo",
): Record<string, unknown> {
  return {
    task,
    text,
    target_language: targetLanguage,
  };
}

async function translateWithModel(
  text: string,
  targetLanguage: string,
  user: string,
  config: { key: string; url: string },
  task: "translate" | "translate_turbo",
): Promise<string | null> {
  return callWorkflowApp(
    modelInputs(text, targetLanguage, task),
    user,
    config.key,
    config.url,
    AbortSignal.timeout(LIVE_MODEL_TIMEOUT_MS),
    "translation",
  );
}

export async function translateSingleSegmentFastDetailed(
  text: string,
  targetLanguage: string,
  callerEmail?: string,
): Promise<LiveTranslationResult | null> {
  const trimmed = text.trim();
  const primaryLabel = "qwen3.6-flash";
  if (!trimmed) return { text: "", provider: primaryLabel, elapsedMs: 0, attempts: 0 };

  const config = translationConfig();
  if (!config) return null;

  const user = callerEmail || process.env.NEXT_PUBLIC_DEV_USER_EMAIL || DEFAULT_CALLER_EMAIL;
  const startedAt = Date.now();

  const primary = await translateWithModel(trimmed, targetLanguage, user, config, "translate");
  if (primary?.trim()) {
    return {
      text: primary.trim(),
      provider: primaryLabel,
      elapsedMs: Date.now() - startedAt,
      attempts: 1,
    };
  }

  if (!isMeetingTranslationFallbackEnabled()) return null;
  const fallback = await translateWithModel(trimmed, targetLanguage, user, config, "translate_turbo");
  if (!fallback?.trim()) return null;

  return {
    text: fallback.trim(),
      provider: "qwen-mt-turbo",
    elapsedMs: Date.now() - startedAt,
    attempts: 2,
  };
}

export async function translateSingleSegmentFast(
  text: string,
  targetLanguage: string,
  callerEmail?: string,
): Promise<string | null> {
  const result = await translateSingleSegmentFastDetailed(text, targetLanguage, callerEmail);
  return result?.text ?? null;
}

/** Bounded concurrency keeps live traffic predictable while each line gets
 * the same primary -> cross-family fallback policy. */
export async function translateBatchFast(
  lines: string[],
  targetLanguage: string,
  callerEmail?: string,
): Promise<(string | null)[]> {
  if (lines.length === 0) return [];

  const user = callerEmail || process.env.NEXT_PUBLIC_DEV_USER_EMAIL || DEFAULT_CALLER_EMAIL;
  const results: (string | null)[] = new Array(lines.length).fill(null);
  const batchSize = 3;

  for (let i = 0; i < lines.length; i += batchSize) {
    const indices = Array.from(
      { length: Math.min(batchSize, lines.length - i) },
      (_, offset) => i + offset,
    );
    const translated = await Promise.all(
      indices.map((index) => translateSingleSegmentFast(lines[index], targetLanguage, user)),
    );
    indices.forEach((index, offset) => {
      results[index] = translated[offset];
    });
  }

  return results;
}
