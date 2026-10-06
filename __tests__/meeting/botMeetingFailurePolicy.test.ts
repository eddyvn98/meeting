import { describe, expect, it } from "vitest";
import { FINALIZING_PREFIX } from "../../lib/meeting/audio/finalizeRetry";
import { shouldFailMeetingForBotFailure } from "../../lib/meeting/bot/meetingFailurePolicy";

describe("meeting bot failure policy", () => {
  it("allows capture failures to mark an open upload retryable", () => {
    expect(shouldFailMeetingForBotFailure(
      { status: "UPLOADING", failureReason: null },
      "CAPTURE",
    )).toBe(true);
  });

  it("does not clobber a finalize lease when the runner fails", () => {
    expect(shouldFailMeetingForBotFailure(
      { status: "UPLOADING", failureReason: `${FINALIZING_PREFIX}2026-10-06T09:00:00.000Z` },
      "CAPTURE",
    )).toBe(false);
  });

  it("does not downgrade a processing meeting for a capture-side failure", () => {
    expect(shouldFailMeetingForBotFailure(
      { status: "PROCESSING", failureReason: null },
      "CAPTURE",
    )).toBe(false);
  });

  it("allows an explicit processing timeout to fail PROCESSING only", () => {
    expect(shouldFailMeetingForBotFailure(
      { status: "PROCESSING", failureReason: null },
      "PROCESSING",
    )).toBe(true);
    expect(shouldFailMeetingForBotFailure(
      { status: "UPLOADING", failureReason: null },
      "PROCESSING",
    )).toBe(false);
  });
});
