/**
 * lib/meeting/ai/difyClient.ts
 *
 * Core HTTP client for dispatching blocking queries to the shared enterprise
 * Dify chat agent via process.env.CHAT_KEY and NEXT_PUBLIC_AGENT_API_URL.
 */

import {
  createUsageStreamObserver,
  recordDifyBlockingResponse,
  requestedModelFromInputs,
  meetingWorkflowCategory,
} from "./difyUsageTracking";

function meetingFeature(inputs: Record<string, unknown> | undefined): string {
  const task = inputs && typeof inputs.task === "string" && inputs.task.trim() ? inputs.task.trim() : null;
  return task ? `meeting:${task.slice(0, 40)}` : "meeting";
}

export function extractAnswer(payload: unknown): string {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  let raw = "";
  if (typeof root.answer === "string" && root.answer.trim()) raw = root.answer;
  else {
    const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : {};
    const outputs = data.outputs && typeof data.outputs === "object" ? (data.outputs as Record<string, unknown>) : {};
    const preferred = [
      outputs.translations_json,
      outputs.insights_json,
      outputs.translated_text,
      outputs.result,
      outputs.text,
      outputs.answer,
      outputs.output,
    ];
    const value = preferred.find((c) => typeof c === "string" && c.trim());
    if (typeof value === "string") raw = value;
    else {
      const fallback = Object.values(outputs).find((c) => typeof c === "string" && c.trim());
      if (typeof fallback === "string") raw = fallback;
    }
  }
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/**
 * Shared blocking call to the CHAT_KEY agent. Returns the extracted answer
 * text, or null (never throws) on any missing config / network / upstream
 * failure, or an unparseable/empty response.
 */
const CHAT_AGENT_TIMEOUT_MS = 45_000;

export async function callChatAgent(
  query: string,
  callerEmail: string,
  extraInputs?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string | null> {
  const apiKey = process.env.CHAT_KEY;
  const url = process.env.NEXT_PUBLIC_AGENT_API_URL;
  if (!apiKey || !url) return null;

  // A hung upstream (blocking response_mode with no server-side timeout)
  // would otherwise stall the whole meeting-processing pipeline forever —
  // this bounds every call so callers' retry/fallback logic can kick in.
  const timeoutSignal = AbortSignal.timeout(CHAT_AGENT_TIMEOUT_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      // selected_skills is a required dict input on this Dify app (see
      // lib/llm/adapters/difyAdapter.ts) even when this caller uses none.
      body: JSON.stringify({
        inputs: { selected_skills: {}, ...extraInputs },
        query,
        response_mode: "blocking",
        user: callerEmail,
      }),
      cache: "no-store",
      signal: combinedSignal,
    });
  } catch {
    return null;
  }
  if (!upstream.ok) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(await upstream.text());
  } catch {
    return null;
  }

  recordDifyBlockingResponse(
    {
      email: callerEmail,
      category: "CHAT_KEY",
      feature: `${meetingFeature(extraInputs)}:chat-agent`,
      difyUrl: url,
      requestedModel: requestedModelFromInputs(extraInputs),
    },
    payload,
  );

  const answer = extractAnswer(payload);
  return answer || null;
}

/**
 * Resolves the {key, url} pair for a dedicated Dify workflow app from a
 * prioritized list of env-var name candidates (oldest/most-specific names
 * kept for backwards compat with existing deployments). Falls back to
 * deriving the workflow URL from NEXT_PUBLIC_AGENT_API_URL when no explicit
 * URL override is set. Shared by every workflow-config resolver
 * (difyMeetingAgent/meetingInsightsAgent/meetingTranslationAgent/
 * deepseekTranslate) so the URL-derivation rule only lives in one place.
 */
export function resolveWorkflowConfig(
  keyEnvNames: string[],
  urlEnvNames: string[] = [],
): { key: string; url: string } | null {
  const key = keyEnvNames.map((name) => process.env[name]).find((v): v is string => Boolean(v));
  if (!key) return null;

  const explicitUrl = urlEnvNames.map((name) => process.env[name]).find((v): v is string => Boolean(v));
  if (explicitUrl) return { key, url: explicitUrl };

  const agentUrl = process.env.NEXT_PUBLIC_AGENT_API_URL;
  if (agentUrl) {
    return { key, url: agentUrl.replace(/\/chat-messages\/?$/, "/workflows/run") };
  }

  return null;
}

/**
 * Shared blocking call to a dedicated Dify workflow app.
 * Returns the extracted output string or null on failure.
 */
export async function callWorkflowApp(
  inputs: Record<string, unknown>,
  callerEmail: string,
  apiKey: string,
  apiUrl: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!apiKey || !apiUrl) return null;

  const timeoutSignal = AbortSignal.timeout(CHAT_AGENT_TIMEOUT_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let upstream: Response;
  try {
    upstream = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs,
        response_mode: "blocking",
        user: callerEmail,
      }),
      cache: "no-store",
      signal: combinedSignal,
    });
  } catch {
    return null;
  }
  if (!upstream.ok) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(await upstream.text());
  } catch {
    return null;
  }

  recordDifyBlockingResponse(
    {
      email: callerEmail,
      category: meetingWorkflowCategory(apiKey),
      feature: meetingFeature(inputs),
      difyUrl: apiUrl,
      requestedModel: requestedModelFromInputs(inputs),
    },
    payload,
  );

  const answer = extractAnswer(payload);
  return answer || null;
}

export interface WorkflowStreamingResult {
  text: string | null;
  completed: boolean;
}

function extractStreamingChunk(payload: unknown): string {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : root;
  for (const key of ["text", "text_chunk"]) {
    if (typeof data[key] === "string") return data[key];
  }
  return "";
}

function findEventBoundary(buffer: string): { index: number; length: number } | null {
  const match = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
  return match ? { index: match.index, length: match[0].length } : null;
}

/**
 * Runs a Dify workflow in SSE mode and forwards text chunks as soon as Dify
 * emits them. The final workflow output is used when the provider emits no
 * text_chunk events, which keeps this compatible with older Dify versions.
 */
export async function callWorkflowAppStreaming(
  inputs: Record<string, unknown>,
  callerEmail: string,
  apiKey: string,
  apiUrl: string,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<WorkflowStreamingResult> {
  if (!apiKey || !apiUrl) return { text: null, completed: false };

  const timeoutSignal = AbortSignal.timeout(CHAT_AGENT_TIMEOUT_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

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
      signal: combinedSignal,
    });
  } catch (error) {
    console.warn("[meeting] Workflow streaming request failed:", error instanceof Error ? error.message : String(error));
    return { text: null, completed: false };
  }
  if (!upstream.ok || !upstream.body) { console.warn(`[meeting] Workflow stream unavailable: ${upstream.status}`); return { text: null, completed: false }; }

  const usage = createUsageStreamObserver(
    {
      email: callerEmail,
      category: meetingWorkflowCategory(apiKey),
      feature: meetingFeature(inputs),
      difyUrl: apiUrl,
      requestedModel: requestedModelFromInputs(inputs),
    },
    "text/event-stream",
  );
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let finalPayload: unknown = null;
  let completed = true;
  let sawTerminalEvent = false;

  const processEvent = (rawEvent: string) => {
    const dataLines = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) return;
    const rawData = dataLines.join("\n").trim();
    if (!rawData || rawData === "[DONE]") return;

    let payload: unknown;
    try {
      payload = JSON.parse(rawData);
    } catch {
      return;
    }

    const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    usage.onEvent(root);
    const event = typeof root.event === "string" ? root.event : "";
    if (event === "error") {
      completed = false;
      return;
    }
    if (event === "workflow_finished") {
      sawTerminalEvent = true;
      finalPayload = payload;
      const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : {};
      if (data.status === "failed" || data.status === "error") completed = false;
    }
    if (event !== "text_chunk") return;

    const chunk = extractStreamingChunk(payload);
    if (chunk) {
      // Dify's text_chunk contract is an incremental delta. Do not infer
      // cumulative snapshots from the text itself: repeated characters are
      // valid deltas and must never be dropped.
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
    usage.finish("complete");
  } catch {
    completed = false;
    usage.finish(combinedSignal.aborted ? "aborted" : "error");
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore cancellation errors after the stream has already closed.
    }
    reader.releaseLock();
  }

  if (!completed || !sawTerminalEvent) return { text: accumulated || null, completed: false };
  const finalText = accumulated || (finalPayload ? extractAnswer(finalPayload) : "");
  if (!accumulated && finalText) onChunk(finalText);
  return { text: finalText || null, completed: true };
}
