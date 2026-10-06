import { describe, expect, it } from "vitest";
import { sanitizeCalendarAttendeeEmails } from "../../lib/meeting/bot/calendarSyncPayload";

describe("calendar attendee identity normalization", () => {
  it("lowercases, validates and deduplicates attendee emails", () => {
    expect(sanitizeCalendarAttendeeEmails([
      "Alice@Example.com",
      "alice@example.com",
      "not-an-email",
      null,
      "bob@example.com",
    ])).toEqual(["alice@example.com", "bob@example.com"]);
  });

  it("returns an empty list for non-array input", () => {
    expect(sanitizeCalendarAttendeeEmails("alice@example.com")).toEqual([]);
  });
});
