/**
 * Shared Dify HTTP client for Meeting.
 *
 * The two Dify apps have separate responsibilities:
 * - meeting_processing: workflows for translation/insights/minutes/etc.
 * - meeting_qa: conversational ask features.
 *
 * Transport retries stay inside the same app. Cross-app fallback is
 * deliberately not allowed here.
 */

import {
  createUsageStreamObserver,
  meetingWorkflowApp,
  recordDifyBlockingResponse,
  recordDifyFailure,
  requestedModelFromInputs,
  type DifyUsageApp,
  type DifyUsageContext,
} from "./difyUsageTracking";
import {
  DIFY_BLOCKING_MAX_ATTEMPTS,
  shouldRetryDifyAttempt,
  waitForDifyRetry,
} from "./difyRetry";

const DIFY_REQUEST_TIMEOUT_MS = 45_000;

function meetingFeature(inputs: Record<string, unknown> | undefined): string {
  const task = inputs && typeof inputs.task === "string" && inputs.task.trim()
    ? inputs.task.trim()
    : null;
  return task ? task.slice(0, 80) : "general";
}

function usageContext(
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

function combinedSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(DIFY_REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function callerAborted(signal?: AbortSignal): boolean {
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

interface BlockingRequestOptions {
  apiKey: string;
  apiUrl: string;
  body: Record<string, unknown>;
  context: DifyUsageContext;
  signal?: AbortSignal;
}

async function runBlockingRequest(options: BlockingRequestOptions): Promise<string | null> {
  for (let attempt = 1; attempt <= DIFY_BLOCKING_MAX_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    let upstream: Response;

    try {
      upstream = await fetch(options.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(options.body),
        cache: "no-store",
        signal: combinedSignal(options.signal),
      });
    } catch (error) {
      await recordDifyFailure(
        options.context,
        attempt,
        callerAborted(options.signal) ? "ABORTED" : "FAILED",
        error,
        undefined,
        startedAt,
      );
      if (callerAborted(options.signal) || !shouldRetryDifyAttempt(attempt)) return null;
      await waitForDifyRetry();
      continue;
    }

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      await recordDifyFailure(
        options.context,
        attempt,
        "FAILED",
        detail || `Dify HTTP ${upstream.status}`,
        upstream.status,
        startedAt,
      );
      if (!shouldRetryDifyAttempt(attempt, upstream.status)) return null;
      await waitForDifyRetry();
      continue;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(await upstream.text());
    } catch (error) {
      await recordDifyFailure(options.context, attempt, "INVALID", error, upstream.status, startedAt);
      if (attempt >= DIFY_BLOCKING_MAX_ATTEMPTS) return null;
      await waitForDifyRetry();
      continue;
    }

    const answer = extractAnswer(payload);
    await recordDifyBlockingResponse(
      options.context,
      payload,
      attempt,
      answer ? "SUCCESS" : "EMPTY",
      upstream.status,
      startedAt,
    );
    if (answer) return answer;
    if (attempt >= DIFY_BLOCKING_MAX_ATTEMPTS) return null;
    await waitForDifyRetry();
  }

  return null;
}

/** Dify chat application used only for conversational Meeting Q&A. */
export async function callChatAgent(
  query: string,
  callerEmail: string,
  extraInputs?: Record<string, unknown>,
  signal?: AbortSignal,
  usageFeature = "ask",
): Promise<string | null> {
  const apiKey = process.env.CHAT_KEY;
  const apiUrl = process.env.NEXT_PUBLIC_AGENT_API_URL;
  if (!apiKey || !apiUrl) return null;

  return runBlockingRequest({
    apiKey,
    apiUrl,
    context: usageContext("meeting_qa", callerEmail, usageFeature, apiUrl, extraInputs),
    signal,
    body: {
      inputs: { selected_skills: {}, ...extraInputs },
      query,
      response_mode: "blocking",
      user: callerEmail,
    },
  });
}

/**
 * Resolves a dedicated Dify workflow app. The shared MEETING_AI_KEY is the
 * preferred processing credential; legacy feature-specific env names remain
 * accepted so deployments can migrate without a flag day.
 */
export function resolveWorkflowConfig(
  keyEnvNames: string[],
  urlEnvNames: string[] = [],
): { key: string; url: string } | null {
  const key = keyEnvNames.map((name) => process.env[name]).find((value): value is string => Boolean(value));
  if (!key) return null;

  const explicitUrl = urlEnvNames.map((name) => process.env[name]).find((value): value is string => Boolean(value));
  if (explicitUrl) return { key, url: explicitUrl };

  const agentUrl = process.env.NEXT_PUBLIC_AGENT_API_URL;
  if (agentUrl) return { key, url: agentUrl.replace(/\/chat-messages\/?$/, "/workflows/run") };

  return null;
}

/** Blocking request to the Meeting processing workflow app. */
export async function callWorkflowApp(
  inputs: Record<string, unknown>,
  callerEmail: string,
  apiKey: string,
  apiUrl: string,
  signal?: AbortSignal,
  usageFeature?: string,
): Promise<string | null> {
  if (!apiKey || !apiUrl) return null;

  return runBlockingRequest({
    apiKey,
    apiUrl,
    context: usageContext(meetingWorkflowApp(), callerEmail, usageFeature || meetingFeature(inputs), apiUrl, inputs),
    signal,
    body: {
      inputs,
      response_mode: "blocking",
      user: callerEmail,
    },
  });
}

export interface WorkflowStreamingResult {
  text: string | null;
  completed: boolean;
}

function extractStreamingChunk(payload: unknown): string {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
  for (const key of ["text", "text_chunk"]) {
    if (typeof data[key] === "string") return data[key] as string;
  }
  return "";
}

function findEventBoundary(buffer: string): { index: number; length: number } | null {
  const match = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
  return match ? { index: match.index, length: match[0].length } : null;
}

/**
 * Streaming requests retry only before any content has been emitted. Once a
 * delta reaches the caller, automatically replaying the workflow could
 * duplicate user-visible text.
 */
export async function callWorkflowAppStreaming(
  inputs: Record<string, unknown>,
  callerEmail: string,
  apiKey: string,
  apiUrl: string,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
  usageFeature?: string,
): Promise<WorkflowStreamingResult> {
  if (!apiKey || !apiUrl) return { text: null, completed: false };

  const context = usageContext(meetingWorkflowApp(), callerEmail, usageFeature || meetingFeature(inputs), apiUrl, inputs);

  for (let attempt = 1; attempt <= DIFY_BLOCKING_MAX_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    let upstream: Response;

    try {
      upstream = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ inputs, response_mode: "streaming", user: callerEmail }),
        cache: "no-store",
        signal: combinedSignal(signal),
      });
    } catch (error) {
      await recordDifyFailure(context, attempt, callerAborted(signal) ? "ABORTED" : "FAILED", error, undefined, startedAt);
      if (callerAborted(signal) || !shouldRetryDifyAttempt(attempt)) return { text: null, completed: false };
      await waitForDifyRetry();
      continue;
    }

    if (!upstream.ok || !upstream.body) {
      await recordDifyFailure(context, attempt, "FAILED", `Dify stream HTTP ${upstream.status}`, upstream.status, startedAt);
      if (!shouldRetryDifyAttempt(attempt, upstream.status)) return { text: null, completed: false };
      await waitForDifyRetry();
      continue;
    }

    const usage = createUsageStreamObserver(context, "text/event-stream", attempt);
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulated = "";
    let finalPayload: unknown = null;
    let completed = true;
    let sawTerminalEvent = false;

    const processEvent = (rawEvent: string) => {
      const rawData = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();
      if (!rawData || rawData === "[DONE]") return;

      let payload: unknown;
      try {
        payload = JSON.parse(rawData);
      } catch {
        return;
      }

      const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      usage.onEvent(root);
      const event = typeof root.event === "string" ? root.event : "";
      if (event === "error") completed = false;
      if (event === "workflow_finished") {
        sawTerminalEvent = true;
        finalPayload = payload;
        const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : {};
        if (data.status === "failed" || data.status === "error") completed = false;
      }
      if (event !== "text_chunk") return;

      const chunk = extractStreamingChunk(payload);
      if (chunk) {
        accumulated += chunk;
        onChunk(chunk);
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = findEventBoundary(buffer);
        while (boundary) {
          processEvent(buffer.slice(0, boundary.index));
          buffer = buffer.slice(boundary.index + boundary.length);
          boundary = findEventBoundary(buffer);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) processEvent(buffer);
    } catch {
      completed = false;
    } finally {
      await usage.finish(completed && sawTerminalEvent ? "complete" : callerAborted(signal) ? "aborted" : "error");
      try { await reader.cancel(); } catch { /* stream already closed */ }
      reader.releaseLock();
    }

    if (completed && sawTerminalEvent) {
      const finalText = accumulated || (finalPayload ? extractAnswer(finalPayload) : "");
      if (!accumulated && finalText) onChunk(finalText);
      return { text: finalText || null, completed: true };
    }

    if (accumulated || callerAborted(signal) || attempt >= DIFY_BLOCKING_MAX_ATTEMPTS) {
      return { text: accumulated || null, completed: false };
    }
    await waitForDifyRetry();
  }

  return { text: null, completed: false };
}
