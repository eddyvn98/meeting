import {
  createUsageStreamObserver,
  meetingWorkflowApp,
  recordDifyFailure,
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
 * delta reaches the caller, replaying the workflow could duplicate text.
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

  const context = usageContext(
    meetingWorkflowApp(),
    callerEmail,
    usageFeature || meetingFeature(inputs),
    apiUrl,
    inputs,
  );

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
        signal: combinedDifySignal(signal),
      });
    } catch (error) {
      await recordDifyFailure(
        context,
        attempt,
        callerAborted(signal) ? "ABORTED" : "FAILED",
        error,
        undefined,
        startedAt,
      );
      if (callerAborted(signal) || !shouldRetryDifyAttempt(attempt)) {
        return { text: null, completed: false };
      }
      await waitForDifyRetry();
      continue;
    }

    if (!upstream.ok || !upstream.body) {
      await recordDifyFailure(
        context,
        attempt,
        "FAILED",
        `Dify stream HTTP ${upstream.status}`,
        upstream.status,
        startedAt,
      );
      if (!shouldRetryDifyAttempt(attempt, upstream.status)) {
        return { text: null, completed: false };
      }
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
        const data = root.data && typeof root.data === "object"
          ? root.data as Record<string, unknown>
          : {};
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
      await usage.finish(
        completed && sawTerminalEvent
          ? "complete"
          : callerAborted(signal)
            ? "aborted"
            : "error",
      );
      try {
        await reader.cancel();
      } catch {
        // Stream already closed.
      }
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
