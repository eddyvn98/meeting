import { describe, expect, it } from "vitest";
import {
  allowedMeetingBotTransitions,
  canTransitionMeetingBotStatus,
} from "../../lib/meeting/bot/statusTransitions";

describe("meeting bot lifecycle transitions", () => {
  it("allows the normal forward lifecycle", () => {
    expect(canTransitionMeetingBotStatus("CLAIMED", "JOINING")).toBe(true);
    expect(canTransitionMeetingBotStatus("JOINING", "LOBBY")).toBe(true);
    expect(canTransitionMeetingBotStatus("LOBBY", "JOINED")).toBe(true);
    expect(canTransitionMeetingBotStatus("JOINED", "CAPTURING")).toBe(true);
    expect(canTransitionMeetingBotStatus("CAPTURING", "STOP_REQUESTED")).toBe(true);
    expect(canTransitionMeetingBotStatus("STOP_REQUESTED", "ENDED")).toBe(true);
  });

  it("rejects backward and terminal transitions", () => {
    expect(canTransitionMeetingBotStatus("STOP_REQUESTED", "CAPTURING")).toBe(false);
    expect(canTransitionMeetingBotStatus("ENDED", "STOP_REQUESTED")).toBe(false);
    expect(canTransitionMeetingBotStatus("FAILED", "CAPTURING")).toBe(false);
    expect(allowedMeetingBotTransitions("ENDED")).toEqual(["ENDED"]);
    expect(allowedMeetingBotTransitions("FAILED")).toEqual(["FAILED"]);
  });

  it("allows failure from active states", () => {
    for (const status of ["CLAIMED", "JOINING", "LOBBY", "JOINED", "CAPTURING", "STOP_REQUESTED"] as const) {
      expect(canTransitionMeetingBotStatus(status, "FAILED")).toBe(true);
    }
  });
});
