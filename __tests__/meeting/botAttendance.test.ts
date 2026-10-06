import { describe, expect, it } from "vitest";
import { buildRosterAttendanceDefaults } from "../../lib/meeting/bot/attendance";

describe("roster attendance defaults", () => {
  it("marks detected participants present and reuses remembered details", () => {
    expect(
      buildRosterAttendanceDefaults(
        ["John Smith", "Mary Tran", "john smith"],
        [{ name: "John Smith", role: "Lead", organization: "Acme" }],
      ),
    ).toEqual([
      expect.objectContaining({ name: "John Smith", role: "Lead", organization: "Acme", status: "present" }),
      expect.objectContaining({ name: "Mary Tran", role: null, organization: null, status: "present" }),
    ]);
  });
});
