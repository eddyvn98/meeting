import { describe, expect, it } from "vitest";
import {
  acceptsAudio,
  CAPTURE_INTERRUPTED_PREFIX,
  FINALIZE_FAILURE_PREFIX,
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
});
