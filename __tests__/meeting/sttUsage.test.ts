import { describe, expect, it } from "vitest";
import {
  calculatePcmDurationMs,
  parseSttUsageRequestMeta,
} from "@/lib/meeting/stt/usage";

describe("meeting STT usage helpers", () => {
  it("calculates 16-bit mono PCM duration from bytes", () => {
    expect(calculatePcmDurationMs(32_000, 16_000)).toBe(1_000);
    expect(calculatePcmDurationMs(96_000, 48_000)).toBe(1_000);
  });

  it("normalizes usage metadata headers", () => {
    const headers = new Headers({
      "x-stt-purpose": "FINAL",
      "x-stt-job-id": "job-123",
      "x-stt-chunk-index": "7",
      "x-stt-attempt": "2",
    });

    expect(parseSttUsageRequestMeta(headers)).toEqual({
      purpose: "final",
      jobId: "job-123",
      chunkIndex: 7,
      attempt: 2,
    });
  });

  it("falls back safely for untrusted metadata", () => {
    const headers = new Headers({
      "x-stt-purpose": "anything",
      "x-stt-chunk-index": "-1",
      "x-stt-attempt": "999",
    });

    expect(parseSttUsageRequestMeta(headers)).toEqual({
      purpose: "unknown",
      jobId: undefined,
      chunkIndex: undefined,
      attempt: 1,
    });
  });
});
