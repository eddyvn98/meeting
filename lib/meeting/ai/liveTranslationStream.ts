import { callChatAgent, callWorkflowAppStreaming, resolveWorkflowConfig } from "./difyClient";
import { parseTranslations } from "./meetingTranslationParser";

const DEFAULT_CALLER_EMAIL = "system@meeting.local";
const PRIMARY_TIMEOUT_MS = 3_000;
const FALLBACK_TIMEOUT_MS = 4_000;
const LEGACY_TIMEOUT_MS = 10_000;

export type LiveStreamProvider = "qwen3.6-flash" | "qwen-mt-turbo" | "legacy-chat";

export interface LiveBatchTranslationItem {
  index: number;
  text: string;
}

export interface LiveBatchTranslationResult {
  translations: Array<{ index: number; text: string }>;
  provider: "dify-batch" | "legacy-chat";
  elapsedMs: number;
  attempts: number;
}

export interface LiveStreamResult {
  text: string;
  provider: LiveStreamProvider;
  elapsedMs: number;
  attempts: number;
}

function getTranslationWorkflowConfig(): { key: string; url: string } | null {
  return resolveWorkflowConfig(
    ["MEETING_AI_KEY", "TRANSLATION_WORKFLOW_KEY", "DIFY_TRANSLATION_API_KEY"],
    ["MEETING_AI_URL", "TRANSLATION_WORKFLOW_URL", "DIFY_TRANSLATION_API_URL"],
  );
}

function buildBatchPrompt(items: LiveBatchTranslationItem[], targetLanguage: string): string {
  const numbered = items.map((item, index) => `[${index}] ${item.text.trim()}`).join("\n");
  return `Translate each numbered line into natural ${targetLanguage}. Reply with ONLY a JSON array of ${items.length} strings in the exact same order. Do not merge, skip, reorder, or explain anything.\n\n${numbered}`;
}

/** Translates a short burst as one workflow so live traffic stays bounded. */
export async function streamLiveTranslationBatch(
  items: LiveBatchTranslationItem[],
  targetLanguage: string,
  callerEmail: string | undefined,
  signal?: AbortSignal,
): Promise<LiveBatchTranslationResult | null> {
  if (items.length === 0) return null;
  const user = callerEmail || process.env.NEXT_PUBLIC_DEV_USER_EMAIL || DEFAULT_CALLER_EMAIL;
  const config = getTranslationWorkflowConfig();
  const startedAt = Date.now();

  if (config) {
    const workflow = await callWorkflowAppStreaming(
      {
        task: "translate_batch",
        text: items.map((item, index) => `[${index}] ${item.text.trim()}`).join("\n"),
        target_language: targetLanguage,
      },
      user,
      config.key,
      config.url,
      () => undefined,
      signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
    );
    const parsed = workflow.completed && workflow.text ? parseTranslations(workflow.text, items.length) : null;
    if (parsed) {
      return {
        translations: parsed.flatMap((text, index) => text ? [{ index: items[index].index, text }] : []),
        provider: "dify-batch",
        elapsedMs: Date.now() - startedAt,
        attempts: 1,
      };
    }
    if (signal?.aborted) return null;
  }

  const fallback = await callChatAgent(
    buildBatchPrompt(items, targetLanguage),
    user,
    undefined,
    signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
  );
  const parsedFallback = fallback ? parseTranslations(fallback, items.length) : null;
  if (!parsedFallback) return null;
  return {
    translations: parsedFallback.flatMap((text, index) => text ? [{ index: items[index].index, text }] : []),
    provider: "legacy-chat",
    elapsedMs: Date.now() - startedAt,
    attempts: config ? 2 : 1,
  };
}

/**
 * Streams a live segment through Qwen3.6 Flash and retries with Qwen-MT Turbo
 * only when the primary workflow fails. The caller receives chunks immediately.
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
  if (!trimmed) return { text: "", provider: "qwen3.6-flash", elapsedMs: 0, attempts: 0 };

  const user = callerEmail || process.env.NEXT_PUBLIC_DEV_USER_EMAIL || DEFAULT_CALLER_EMAIL;
  const config = getTranslationWorkflowConfig();
  const startedAt = Date.now();

  if (config) {
    const primary = await callWorkflowAppStreaming(
      { task: "translate", text: trimmed, target_language: targetLanguage },
      user,
      config.key,
      config.url,
      (chunk) => onChunk(chunk, "qwen3.6-flash"),
      signal ? AbortSignal.any([signal, AbortSignal.timeout(PRIMARY_TIMEOUT_MS)]) : AbortSignal.timeout(PRIMARY_TIMEOUT_MS),
    );
    if (primary.completed && primary.text?.trim()) {
      return {
        text: primary.text.trim(),
        provider: "qwen3.6-flash",
        elapsedMs: Date.now() - startedAt,
        attempts: 1,
      };
    }

    if (signal?.aborted) return null;
    onFallback("qwen-mt-turbo");
    const fallback = await callWorkflowAppStreaming(
      { task: "translate_turbo", text: trimmed, target_language: targetLanguage },
      user,
      config.key,
      config.url,
      (chunk) => onChunk(chunk, "qwen-mt-turbo"),
      signal ? AbortSignal.any([signal, AbortSignal.timeout(FALLBACK_TIMEOUT_MS)]) : AbortSignal.timeout(FALLBACK_TIMEOUT_MS),
    );
    if (fallback.completed && fallback.text?.trim()) {
      return {
        text: fallback.text.trim(),
        provider: "qwen-mt-turbo",
        elapsedMs: Date.now() - startedAt,
        attempts: 2,
      };
    }
  }

  if (signal?.aborted) return null;
  onFallback("legacy-chat");
  const prompt = `You are a real-time speech translator. Translate the following text directly into natural ${targetLanguage}. Reply with ONLY the direct translation, with no quotes, explanations, markdown formatting, or altered punctuation:\n\n${trimmed}`;
  const legacySignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(LEGACY_TIMEOUT_MS)])
    : AbortSignal.timeout(LEGACY_TIMEOUT_MS);
  const legacy = await callChatAgent(prompt, user, undefined, legacySignal);
  if (!legacy?.trim()) return null;
  onChunk(legacy.trim(), "legacy-chat");
  return {
    text: legacy.trim(),
    provider: "legacy-chat",
    elapsedMs: Date.now() - startedAt,
    attempts: config ? 3 : 1,
  };
}
