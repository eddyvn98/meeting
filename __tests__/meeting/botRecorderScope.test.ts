import { describe, expect, it } from "vitest";
import { isBotRecorderRequestAllowed } from "../../lib/meeting/bot/recorderScope";

const baseSession = {
  id: "session-a",
  ownerEmail: "owner@example.com",
  status: "CAPTURING",
  meetingId: "meeting-a",
};

describe("meeting bot recorder scope", () => {
  it("allows only its bound meeting subtree", () => {
    expect(isBotRecorderRequestAllowed("/api/meeting/meeting-a", "GET", baseSession)).toBe(true);
    expect(isBotRecorderRequestAllowed("/api/meeting/meeting-a/chunks", "POST", baseSession)).toBe(true);
    expect(isBotRecorderRequestAllowed("/api/meeting/meeting-a/finalize", "POST", baseSession)).toBe(true);
    expect(isBotRecorderRequestAllowed("/api/meeting/meeting-a/processing-heartbeat", "POST", baseSession)).toBe(true);
    expect(isBotRecorderRequestAllowed("/api/meeting/meeting-a/transcribe-fast", "POST", baseSession)).toBe(true);
    expect(isBotRecorderRequestAllowed("/api/meeting/meeting-a/transcript", "POST", baseSession)).toBe(true);
    expect(isBotRecorderRequestAllowed("/api/meeting/voice-profiles", "GET", baseSession)).toBe(true);
    expect(isBotRecorderRequestAllowed("/api/meeting/meeting-b", "GET", baseSession)).toBe(false);
    expect(isBotRecorderRequestAllowed("/api/meeting/meeting-b/chunks", "POST", baseSession)).toBe(false);
  });

  it("never lets the recorder mutate the meeting root or use admin endpoints", () => {
    expect(isBotRecorderRequestAllowed("/api/meeting/meeting-a", "DELETE", baseSession)).toBe(false);
    expect(isBotRecorderRequestAllowed("/api/meeting/meeting-a", "PATCH", baseSession)).toBe(false);
    expect(isBotRecorderRequestAllowed("/api/meeting/bot-sessions", "GET", baseSession)).toBe(false);
    expect(isBotRecorderRequestAllowed("/api/meeting/notifications", "GET", baseSession)).toBe(false);
    expect(isBotRecorderRequestAllowed("/api/meeting/groups", "GET", baseSession)).toBe(false);
    expect(isBotRecorderRequestAllowed("/api/meeting/meeting-a/shares", "POST", baseSession)).toBe(false);
    expect(isBotRecorderRequestAllowed("/api/meeting/meeting-a/public-share", "POST", baseSession)).toBe(false);
    expect(isBotRecorderRequestAllowed("/api/meeting/meeting-a/comments", "POST", baseSession)).toBe(false);
    expect(isBotRecorderRequestAllowed("/api/meeting/voice-profiles", "POST", baseSession)).toBe(false);
  });

  it("allows exactly one root POST before the recorder is bound", () => {
    const unbound = { ...baseSession, status: "JOINED", meetingId: null };
    expect(isBotRecorderRequestAllowed("/api/meeting", "POST", unbound)).toBe(true);
    expect(isBotRecorderRequestAllowed("/api/meeting", "GET", unbound)).toBe(false);
    expect(isBotRecorderRequestAllowed("/api/meeting/translate-live", "POST", unbound)).toBe(true);
  });

  it("rejects inactive recorder sessions", () => {
    for (const status of ["REQUESTED", "ENDED", "FAILED"]) {
      expect(isBotRecorderRequestAllowed("/api/meeting/meeting-a/chunks", "POST", { ...baseSession, status })).toBe(false);
    }
  });
});
