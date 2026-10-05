import { describe, expect, it } from "vitest";
import {
  parseDifyUsage,
  requestedModelFromInputs,
} from "@/lib/meeting/ai/difyUsageTracking";
import {
  isRetriableDifyStatus,
  shouldRetryDifyAttempt,
} from "@/lib/meeting/ai/difyRetry";

describe("Dify usage parsing", () => {
  it("reads chat metadata usage", () => {
    expect(parseDifyUsage({
      message_id: "msg-1",
      metadata: {
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          total_tokens: 150,
          total_price: "0.00125",
          currency: "USD",
          latency: 1.25,
          model: "deepseek-v4-flash",
        },
      },
    })).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      totalPrice: 0.00125,
      currency: "USD",
      latencyMs: 1250,
      providerModel: "deepseek-v4-flash",
      providerRequestId: "msg-1",
      workflowRunId: undefined,
    });
  });

  it("reads workflow totals when prompt/completion split is unavailable", () => {
    expect(parseDifyUsage({
      task_id: "task-1",
      data: {
        id: "run-1",
        total_tokens: 420,
        total_price: 0.004,
        currency: "USD",
        elapsed_time: 2.5,
      },
    })).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 420,
      totalPrice: 0.004,
      currency: "USD",
      latencyMs: 2500,
      providerRequestId: "task-1",
      workflowRunId: "run-1",
    });
  });

  it("reads explicit model selectors", () => {
    expect(requestedModelFromInputs({ model_selector: "deepseek-v4-flash" }))
      .toBe("deepseek-v4-flash");
    expect(requestedModelFromInputs({})).toBeNull();
  });
});

describe("Dify retry policy", () => {
  it("retries transient HTTP failures", () => {
    expect(isRetriableDifyStatus(408)).toBe(true);
    expect(isRetriableDifyStatus(429)).toBe(true);
    expect(isRetriableDifyStatus(503)).toBe(true);
    expect(isRetriableDifyStatus(401)).toBe(false);
    expect(isRetriableDifyStatus(422)).toBe(false);
  });

  it("allows one retry only", () => {
    expect(shouldRetryDifyAttempt(1, 503)).toBe(true);
    expect(shouldRetryDifyAttempt(2, 503)).toBe(false);
    expect(shouldRetryDifyAttempt(1, 401)).toBe(false);
  });
});
