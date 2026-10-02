import { describe, expect, it } from "vitest";
import { acceptsAudio, isRetryableFinalizeFailure, FINALIZE_FAILURE_PREFIX } from "@/lib/meeting/audio/finalizeRetry";
import { normalizeMeetingEmail, isKnownMeetingUserEmail } from "@/lib/meeting/identity";
import { formatClock, initialsOf } from "@/lib/meeting/format";

describe("Meeting core helpers", () => {
  it("normalizes valid email identities and rejects malformed values", () => {
    expect(normalizeMeetingEmail("  PERSON@example.com ")).toBe("person@example.com");
    expect(normalizeMeetingEmail("not-an-email")).toBeNull();
    expect(isKnownMeetingUserEmail("person@example.com")).toBe(true);
  });

  it("keeps audio retryable after a finalize failure", () => {
    const meeting = { status: "FAILED", failureReason: `${FINALIZE_FAILURE_PREFIX}merge failed` };
    expect(isRetryableFinalizeFailure(meeting)).toBe(true);
    expect(acceptsAudio(meeting)).toBe(true);
    expect(acceptsAudio({ status: "FAILED", failureReason: "transcription failed" })).toBe(false);
  });

  it("formats duration and participant initials", () => {
    expect(formatClock(65_000)).toBe("1:05");
    expect(initialsOf("Alex Example")).toBe("AE");
  });
});
