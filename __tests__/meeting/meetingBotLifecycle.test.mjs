import { describe, expect, it } from "vitest";
import {
  detectTeamsPageState,
  isAloneFromCount,
  nextAloneState,
  parseParticipantCount,
  participantCountFromRoster,
} from "../../scripts/meeting-bot-lifecycle.mjs";

describe("Teams lifecycle classification", () => {
  it("detects lobby, rejection, removal, meeting end and reconnect states", () => {
    expect(detectTeamsPageState("Waiting in the lobby. Someone will let you in soon.")).toBe("LOBBY");
    expect(detectTeamsPageState("Someone declined your request to join.")).toBe("REJECTED");
    expect(detectTeamsPageState("Your request to join was declined.")).toBe("REJECTED");
    expect(detectTeamsPageState("You were removed from the meeting.")).toBe("REMOVED");
    expect(detectTeamsPageState("Someone removed you from the meeting.")).toBe("REMOVED");
    expect(detectTeamsPageState("The organizer ended the meeting.")).toBe("MEETING_ENDED");
    expect(detectTeamsPageState("This meeting is over.")).toBe("MEETING_ENDED");
    expect(detectTeamsPageState("Connection lost. Trying to reconnect...")).toBe("RECONNECTING");
    expect(detectTeamsPageState("You've left the meeting.")).toBe("LEFT");
    expect(detectTeamsPageState("Sign in to join this meeting.")).toBe("ACCESS_DENIED");
    expect(detectTeamsPageState("This meeting link is invalid.")).toBe("INVALID_LINK");
  });

  it("understands Vietnamese participant counts", () => {
    expect(parseParticipantCount("Người tham gia (5)")).toBe(5);
    expect(parseParticipantCount("2 người tham gia")).toBe(2);
    expect(isAloneFromCount(parseParticipantCount("1 người"))).toBe(true);
  });

  it("counts the bot when roster fallback sees one human", () => {
    const oneHumanPlusBot = participantCountFromRoster(1);
    expect(oneHumanPlusBot).toBe(2);
    expect(isAloneFromCount(oneHumanPlusBot)).toBe(false);
    expect(participantCountFromRoster(0)).toBeNull();
  });

  it("only ends after one continuous alone streak", () => {
    const first = nextAloneState({ aloneSinceMs: null }, true, 1_000, 5_000);
    expect(first.shouldEnd).toBe(false);
    const reset = nextAloneState(first, false, 3_000, 5_000);
    expect(reset.aloneSinceMs).toBeNull();
    const second = nextAloneState(reset, true, 10_000, 5_000);
    const done = nextAloneState(second, true, 15_000, 5_000);
    expect(done.shouldEnd).toBe(true);
  });
});
