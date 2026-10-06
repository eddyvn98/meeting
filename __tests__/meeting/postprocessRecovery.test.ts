import { describe, expect, it } from "vitest";
import { canRetryPostprocess } from "../../lib/meeting/processing/postprocessRecovery";

describe("Meeting postprocess recovery", () => {
  const now = Date.UTC(2026, 9, 6, 10, 0, 0);

  it("allows pending and failed jobs to retry", () => {
    expect(canRetryPostprocess("PENDING", now, now)).toBe(true);
    expect(canRetryPostprocess("FAILED", now, now)).toBe(true);
  });

  it("only retries a running job after its stale deadline", () => {
    expect(canRetryPostprocess("RUNNING", now - 60_000, now, 120_000)).toBe(false);
    expect(canRetryPostprocess("RUNNING", now - 120_000, now, 120_000)).toBe(true);
  });

  it("never retries completed or not-started jobs", () => {
    expect(canRetryPostprocess("DONE", now, now)).toBe(false);
    expect(canRetryPostprocess("NOT_STARTED", now, now)).toBe(false);
  });
});
