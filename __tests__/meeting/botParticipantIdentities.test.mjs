import { describe, expect, it } from "vitest";
import {
  extractEmailsFromText,
  teamsJoinIdentity,
} from "../../scripts/meeting-bot-participant-identities.mjs";

describe("browser participant identity helpers", () => {
  it("extracts and deduplicates visible email addresses", () => {
    expect(extractEmailsFromText(
      "Nguyen Van A <A.User@Example.com>\nmailto:a.user@example.com\nB.User@example.com",
    )).toEqual(["a.user@example.com", "b.user@example.com"]);
  });

  it("does not invent an email from a display name", () => {
    expect(extractEmailsFromText("Nguyen Van A\nOrganizer")).toEqual([]);
  });

  it("matches a Teams meeting by host and join path, not query parameters", () => {
    expect(teamsJoinIdentity(
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC%40thread.v2/0?context=one",
    )).toBe(
      "teams.microsoft.com/l/meetup-join/19:meeting_abc@thread.v2/0",
    );
    expect(teamsJoinIdentity(
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC%40thread.v2/0?context=two",
    )).toBe(
      "teams.microsoft.com/l/meetup-join/19:meeting_abc@thread.v2/0",
    );
  });

  it("rejects non-Teams links as meeting identities", () => {
    expect(teamsJoinIdentity("https://example.com/l/meetup-join/test")).toBeNull();
  });
});
