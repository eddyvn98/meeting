import { describe, expect, it } from "vitest";
import { sanitizeMeetingAttendeeEmails } from "../../lib/meeting/bot/attendeeEmails";

describe("calendar attendee identity normalization", () => {
  it("lowercases, validates and deduplicates attendee emails", () => {
    expect(sanitizeMeetingAttendeeEmails([
      "Alice@Example.com",
      "alice@example.com",
      "not-an-email",
      null,
      "bob@example.com",
    ])).toEqual(["alice@example.com", "bob@example.com"]);
  });

  it("returns an empty list for non-array input", () => {
    expect(sanitizeMeetingAttendeeEmails("alice@example.com")).toEqual([]);
  });
});
