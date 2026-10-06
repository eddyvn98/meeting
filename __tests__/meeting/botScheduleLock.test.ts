import { describe, expect, it } from "vitest";
import { meetingBotScheduleLockKey } from "../../lib/meeting/bot/scheduleLock";

describe("Meeting bot schedule lock", () => {
  it("uses one stable lock namespace for dispatch/edit/delete", () => {
    expect(meetingBotScheduleLockKey("schedule-a")).toBe("meeting-bot-schedule:schedule-a");
    expect(meetingBotScheduleLockKey("schedule-b")).not.toBe(meetingBotScheduleLockKey("schedule-a"));
  });
});
