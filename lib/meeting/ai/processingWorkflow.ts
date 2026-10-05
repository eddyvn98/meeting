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
  signal?: AbortSignal;
}

function envModel(feature: MeetingProcessingFeature, kind: "PRIMARY" | "FALLBACK"): string | undefined {
  const featureKey = `MEETING_DIFY_${feature.toUpperCase()}_${kind}_MODEL`;
  return process.env[featureKey]?.trim() || process.env[`MEETING_DIFY_${kind}_MODEL`]?.trim() || undefined;
}

export function getProcessingModelPolicy(feature: MeetingProcessingFeature): {
  primaryModel?: string;
  fallbackModel?: string;
} {
  return {
    primaryModel: envModel(feature, "PRIMARY"),
    fallbackModel: envModel(feature, "FALLBACK"),
  };
}

export function getMeetingProcessingConfig(
  legacyKeyEnvNames: string[] = [],
  legacyUrlEnvNames: string[] = [],
): { key: string; url: string } | null {
  return resolveWorkflowConfig(
    ["MEETING_AI_KEY", ...legacyKeyEnvNames],
    ["MEETING_AI_URL", ...legacyUrlEnvNames],
  );
}

/**
 * Runs a processing feature only inside the Meeting processing Dify app.
 *
 * callWorkflowApp already retries transient transport/upstream failures once.
 * If a fallback model is configured, this function then retries the same
 * workflow app with another model selector. The Dify workflow must expose a
 * string input named model_selector for explicit model routing.
 */
export async function callProcessingWorkflow(options: ProcessingCallOptions): Promise<string | null> {
  const config = getMeetingProcessingConfig(options.legacyKeyEnvNames, options.legacyUrlEnvNames);
  if (!config) return null;

  const { primaryModel, fallbackModel } = getProcessingModelPolicy(options.feature);

  const primaryInputs = primaryModel
    ? { ...options.inputs, model_selector: primaryModel }
    : options.inputs;

  const primary = await callWorkflowApp(
    primaryInputs,
    options.callerEmail,
    config.key,
    config.url,
    options.signal,
    options.feature,
  );
  if (primary) return primary;

  if (!fallbackModel || fallbackModel === primaryModel || options.signal?.aborted) return null;

  return callWorkflowApp(
    { ...options.inputs, model_selector: fallbackModel },
    options.callerEmail,
    config.key,
    config.url,
    options.signal,
    options.feature,
  );
}
