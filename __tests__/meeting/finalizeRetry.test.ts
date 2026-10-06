import { describe, expect, it } from "vitest";
import {
  acceptsAudio,
  CAPTURE_INTERRUPTED_PREFIX,
  FINALIZE_FAILURE_PREFIX,
  FINALIZING_PREFIX,
  isFinalizeInProgress,
  isFinalizeLeaseStale,
  isRetryableFinalizeFailure,
} from "../../lib/meeting/audio/finalizeRetry";

describe("meeting finalize retry states", () => {
  it("keeps interrupted bot capture audio recoverable", () => {
    const meeting = {
      status: "FAILED",
      failureReason: `${CAPTURE_INTERRUPTED_PREFIX}runner heartbeat expired`,
    };
    expect(isRetryableFinalizeFailure(meeting)).toBe(true);
    expect(acceptsAudio(meeting)).toBe(true);
  });

  it("keeps finalize failures recoverable", () => {
    expect(acceptsAudio({
      status: "FAILED",
      failureReason: `${FINALIZE_FAILURE_PREFIX}ffmpeg failed`,
    })).toBe(true);
  });

  it("does not reopen unrelated processing failures", () => {
    expect(acceptsAudio({
      status: "FAILED",
      failureReason: "Transcription failed",
    })).toBe(false);
  });
  it("freezes new uploads while a finalize lease is active", () => {
    const meeting = {
      status: "UPLOADING",
      failureReason: `${FINALIZING_PREFIX}2026-10-06T08:00:00.000Z`,
    };
    expect(isFinalizeInProgress(meeting)).toBe(true);
    expect(acceptsAudio(meeting)).toBe(false);
  });
  it("distinguishes a live finalize lease from a stale reclaimable lease", () => {
    const meeting = {
      status: "UPLOADING",
      failureReason: `${FINALIZING_PREFIX}2026-10-06T08:00:00.000Z`,
    };
    const startedAt = Date.parse("2026-10-06T08:00:00.000Z");
    expect(isFinalizeLeaseStale(meeting, startedAt + 19 * 60_000)).toBe(false);
    expect(isFinalizeLeaseStale(meeting, startedAt + 20 * 60_000)).toBe(true);
  });
});
