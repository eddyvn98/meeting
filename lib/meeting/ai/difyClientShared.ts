import {
  requestedModelFromInputs,
  type DifyUsageApp,
  type DifyUsageContext,
} from "./difyUsageTracking";

const DIFY_REQUEST_TIMEOUT_MS = 45_000;

export function meetingFeature(inputs: Record<string, unknown> | undefined): string {
  const task = inputs && typeof inputs.task === "string" && inputs.task.trim()
    ? inputs.task.trim()
    : null;
  return task ? task.slice(0, 80) : "general";
}

export function usageContext(
  app: DifyUsageApp,
  email: string,
  feature: string,
  difyUrl: string,
  inputs?: Record<string, unknown>,
): DifyUsageContext {
  return {
    email,
    app,
    feature,
    difyUrl,
    requestedModel: requestedModelFromInputs(inputs),
  };
}

export function combinedDifySignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(DIFY_REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function callerAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

export function extractAnswer(payload: unknown): string {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  let raw = "";
  if (typeof root.answer === "string" && root.answer.trim()) raw = root.answer;
  else {
    const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : {};
    const outputs = data.outputs && typeof data.outputs === "object" ? data.outputs as Record<string, unknown> : {};
    const preferred = [
      outputs.translations_json,
      outputs.insights_json,
      outputs.translated_text,
      outputs.result,
      outputs.text,
      outputs.answer,
      outputs.output,
    ];
    const value = preferred.find((candidate) => typeof candidate === "string" && candidate.trim());
    if (typeof value === "string") raw = value;
    else {
      const fallback = Object.values(outputs).find((candidate) => typeof candidate === "string" && candidate.trim());
      if (typeof fallback === "string") raw = fallback;
    }
  }
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
