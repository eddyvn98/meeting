import { describe, expect, it } from "vitest";
import { cleanRosterName } from "../../scripts/meeting-bot-roster.mjs";

describe("Teams roster parsing", () => {
  it("extracts participant names and strips Teams status labels", () => {
    expect(cleanRosterName("John Smith\nMuted\nOrganizer")).toBe("John Smith");
    expect(cleanRosterName("Nguyen Van A (Guest)\nĐã tắt tiếng")).toBe("Nguyen Van A");
  });

  it("ignores non-participant labels", () => {
    expect(cleanRosterName("People\nParticipants")).toBeNull();
  });
});
