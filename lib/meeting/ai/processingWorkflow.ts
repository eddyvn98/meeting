import { callWorkflowApp, resolveWorkflowConfig } from "./difyClient";

export type MeetingProcessingFeature =
  | "translation"
  | "insights"
  | "summary"
  | "minutes"
  | "section"
  | "mindmap"
  | "processing";

interface ProcessingCallOptions {
  inputs: Record<string, unknown>;
  callerEmail: string;
  feature: MeetingProcessingFeature;
  legacyKeyEnvNames?: string[];
  legacyUrlEnvNames?: string[];
  /** External cancellation only (for example the HTTP request closing). */
  signal?: AbortSignal;
  /** Maximum time allowed for this upstream processing request. */
  modelTimeoutMs?: number;
  validateAnswer?: (answer: string) => boolean;
}

function modelSignal(options: ProcessingCallOptions): AbortSignal | undefined {
  const timeout = options.modelTimeoutMs && options.modelTimeoutMs > 0
    ? AbortSignal.timeout(options.modelTimeoutMs)
    : undefined;
  if (options.signal && timeout) return AbortSignal.any([options.signal, timeout]);
  return options.signal ?? timeout;
}

export function isMeetingTranslationFallbackEnabled(): boolean {
  return process.env.MEETING_DIFY_TRANSLATION_FALLBACK_ENABLED?.trim().toLowerCase() === "true";
}

export function getMeetingProcessingConfig(
  _legacyKeyEnvNames: string[] = [],
  _legacyUrlEnvNames: string[] = [],
): { key: string; url: string } | null {
  return resolveWorkflowConfig(
    ["MEETING_AI_KEY"],
    ["MEETING_AI_URL"],
  );
}

/**
 * Runs a processing feature only inside the Meeting processing Dify app.
 *
 * callWorkflowApp already retries transient transport/upstream failures once.
 * Model selection stays in Dify; raw model names in runtime inputs are not
 * interpreted as model selectors by the workflow app.
 */
export async function callProcessingWorkflow(options: ProcessingCallOptions): Promise<string | null> {
  const config = getMeetingProcessingConfig(options.legacyKeyEnvNames, options.legacyUrlEnvNames);
  if (!config) return null;

  return callWorkflowApp(
    options.inputs,
    options.callerEmail,
    config.key,
    config.url,
    modelSignal(options),
    options.feature,
    options.validateAnswer,
  );
}
