import { callWorkflowAppStreaming } from "./difyClient";
import {
  getMeetingProcessingConfig,
  getProcessingModelPolicy,
} from "./processingWorkflow";
import { parseTranslations } from "./meetingTranslationParser";

const DEFAULT_CALLER_EMAIL = "system@meeting.local";
const PRIMARY_TIMEOUT_MS = 5_000;
const FALLBACK_TIMEOUT_MS = 6_000;
const TRANSLATION_LEGACY_KEYS = ["TRANSLATION_WORKFLOW_KEY", "DIFY_TRANSLATION_API_KEY"];
const TRANSLATION_LEGACY_URLS = ["TRANSLATION_WORKFLOW_URL", "DIFY_TRANSLATION_API_URL"];

export type LiveStreamProvider = string;

export interface LiveBatchTranslationItem {
  index: number;
  text: string;
}

export interface LiveBatchTranslationResult {
  translations: Array<{ index: number; text: string }>;
  provider: string;
  elapsedMs: number;
  attempts: number;
}

export interface LiveStreamResult {
  text: string;
  provider: LiveStreamProvider;
  elapsedMs: number;
  attempts: number;
}

function translationConfig(): { key: string; url: string } | null {
  return getMeetingProcessingConfig(TRANSLATION_LEGACY_KEYS, TRANSLATION_LEGACY_URLS);
}

function modelInputs(inputs: Record<string, unknown>, model?: string): Record<string, unknown> {
  return model ? { ...inputs, model_selector: model } : inputs;
}

function modelLabel(model: string | undefined, role: "primary" | "fallback"): string {
  return model || `processing-${role}`;
}

async function runBatchModel(
  model: string | undefined,
  items: LiveBatchTranslationItem[],
  targetLanguage: string,
  user: string,
  config: { key: string; url: string },
  signal?: AbortSignal,
) {
  return callWorkflowAppStreaming(
    modelInputs({
      task: "translate_batch",
      text: items.map((item, index) => `[${index}] ${item.text.trim()}`).join("\n"),
      target_language: targetLanguage,
    }, model),
    user,
    config.key,
    config.url,
    () => undefined,
    signal,
    "translation",
  );
}

/** Live batch translation stays entirely inside the processing Dify app. */
export async function streamLiveTranslationBatch(
  items: LiveBatchTranslationItem[],
  targetLanguage: string,
  callerEmail: string | undefined,
  signal?: AbortSignal,
): Promise<LiveBatchTranslationResult | null> {
  if (items.length === 0) return null;

  const user = callerEmail || process.env.NEXT_PUBLIC_DEV_USER_EMAIL || DEFAULT_CALLER_EMAIL;
  const config = translationConfig();
  if (!config) return null;

  const startedAt = Date.now();
  const { primaryModel, fallbackModel } = getProcessingModelPolicy("translation");
  const primarySignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(8_000)])
    : AbortSignal.timeout(8_000);
  const primary = await runBatchModel(primaryModel, items, targetLanguage, user, config, primarySignal);
  let parsed = primary.completed && primary.text ? parseTranslations(primary.text, items.length) : null;
  if (parsed) {
    return {
      translations: parsed.flatMap((text, index) => text ? [{ index: items[index].index, text }] : []),
      provider: modelLabel(primaryModel, "primary"),
      elapsedMs: Date.now() - startedAt,
      attempts: 1,
    };
  }

  if (signal?.aborted || !fallbackModel || fallbackModel === primaryModel) return null;

  const fallbackSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
    : AbortSignal.timeout(10_000);
  const fallback = await runBatchModel(fallbackModel, items, targetLanguage, user, config, fallbackSignal);
  parsed = fallback.completed && fallback.text ? parseTranslations(fallback.text, items.length) : null;
  if (!parsed) return null;

  return {
    translations: parsed.flatMap((text, index) => text ? [{ index: items[index].index, text }] : []),
    provider: modelLabel(fallbackModel, "fallback"),
    elapsedMs: Date.now() - startedAt,
    attempts: 2,
  };
}

/**
 * Primary and fallback models use the same Dify processing app. Configure the
 * fallback as a different model family to reduce correlated failures.
 */
export async function streamLiveTranslation(
  text: string,
  targetLanguage: string,
  callerEmail: string | undefined,
  onChunk: (chunk: string, provider: LiveStreamProvider) => void,
  onFallback: (provider: LiveStreamProvider) => void,
  signal?: AbortSignal,
): Promise<LiveStreamResult | null> {
  const trimmed = text.trim();
  const { primaryModel, fallbackModel } = getProcessingModelPolicy("translation");
  const primaryLabel = modelLabel(primaryModel, "primary");
  if (!trimmed) return { text: "", provider: primaryLabel, elapsedMs: 0, attempts: 0 };

  const user = callerEmail || process.env.NEXT_PUBLIC_DEV_USER_EMAIL || DEFAULT_CALLER_EMAIL;
  const config = translationConfig();
  if (!config) return null;
  const startedAt = Date.now();

  const primarySignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(PRIMARY_TIMEOUT_MS)])
    : AbortSignal.timeout(PRIMARY_TIMEOUT_MS);
  const primary = await callWorkflowAppStreaming(
    modelInputs({ task: "translate", text: trimmed, target_language: targetLanguage }, primaryModel),
    user,
    config.key,
    config.url,
    (chunk) => onChunk(chunk, primaryLabel),
    primarySignal,
    "translation",
  );
  if (primary.completed && primary.text?.trim()) {
    return {
      text: primary.text.trim(),
      provider: primaryLabel,
      elapsedMs: Date.now() - startedAt,
      attempts: 1,
    };
  }

  if (signal?.aborted || !fallbackModel || fallbackModel === primaryModel) return null;

  const fallbackLabel = modelLabel(fallbackModel, "fallback");
  onFallback(fallbackLabel);
  const fallbackSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(FALLBACK_TIMEOUT_MS)])
    : AbortSignal.timeout(FALLBACK_TIMEOUT_MS);
  const fallback = await callWorkflowAppStreaming(
    modelInputs({ task: "translate", text: trimmed, target_language: targetLanguage }, fallbackModel),
    user,
    config.key,
    config.url,
    (chunk) => onChunk(chunk, fallbackLabel),
    fallbackSignal,
    "translation",
  );
  if (!fallback.completed || !fallback.text?.trim()) return null;

  return {
    text: fallback.text.trim(),
    provider: fallbackLabel,
    elapsedMs: Date.now() - startedAt,
    attempts: 2,
  };
}
