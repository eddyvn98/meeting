import { describe, expect, it } from "vitest";
import {
  acceptsAudio,
  canMarkCaptureInterrupted,
  CAPTURE_INTERRUPTED_PREFIX,
  FINALIZE_FAILURE_PREFIX,
  FINALIZING_PREFIX,
  isFinalizeInProgress,
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

  it("only lets bot failure interrupt an open capture", () => {
    expect(canMarkCaptureInterrupted({
      status: "UPLOADING",
      failureReason: null,
    })).toBe(true);
    expect(canMarkCaptureInterrupted({
      status: "UPLOADING",
      failureReason: `${FINALIZING_PREFIX}2026-10-06T08:00:00.000Z`,
    })).toBe(false);
    expect(canMarkCaptureInterrupted({
      status: "PROCESSING",
      failureReason: null,
    })).toBe(false);
  });
});
