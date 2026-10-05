/**
 * Blocking Dify HTTP client for Meeting.
 *
 * Transport retries stay inside the same Dify app. Cross-app fallback is
 * deliberately not allowed here.
 */

import {
  meetingWorkflowApp,
  recordDifyBlockingResponse,
  recordDifyFailure,
  type DifyUsageContext,
} from "./difyUsageTracking";
import {
  DIFY_BLOCKING_MAX_ATTEMPTS,
  shouldRetryDifyAttempt,
  waitForDifyRetry,
} from "./difyRetry";
import {
  callerAborted,
  combinedDifySignal,
  extractAnswer,
  meetingFeature,
  usageContext,
} from "./difyClientShared";

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
        signal: combinedDifySignal(options.signal),
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
      await recordDifyFailure(
        options.context,
        attempt,
        "INVALID",
        error,
        upstream.status,
        startedAt,
      );
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

/** Dify chat application used for conversational Meeting features. */
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
 * Resolves a dedicated Dify workflow app. MEETING_AI_KEY is preferred;
 * legacy feature-specific env names remain accepted during migration.
 */
export function resolveWorkflowConfig(
  keyEnvNames: string[],
  urlEnvNames: string[] = [],
): { key: string; url: string } | null {
  const key = keyEnvNames
    .map((name) => process.env[name])
    .find((value): value is string => Boolean(value));
  if (!key) return null;

  const explicitUrl = urlEnvNames
    .map((name) => process.env[name])
    .find((value): value is string => Boolean(value));
  if (explicitUrl) return { key, url: explicitUrl };

  const agentUrl = process.env.NEXT_PUBLIC_AGENT_API_URL;
  if (agentUrl) {
    return { key, url: agentUrl.replace(/\/chat-messages\/?$/, "/workflows/run") };
  }

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
    context: usageContext(
      meetingWorkflowApp(),
      callerEmail,
      usageFeature || meetingFeature(inputs),
      apiUrl,
      inputs,
    ),
    signal,
    body: {
      inputs,
      response_mode: "blocking",
      user: callerEmail,
    },
  });
}

export { extractAnswer } from "./difyClientShared";
export {
  callWorkflowAppStreaming,
  type WorkflowStreamingResult,
} from "./difyStreamingClient";
