import { describe, expect, it } from "vitest";
import { extractEmailsFromText } from "../../scripts/meeting-bot-participant-identities.mjs";

describe("browser participant identity helpers", () => {
  it("extracts and deduplicates visible email addresses", () => {
    expect(extractEmailsFromText(
      "Nguyen Van A <A.User@Example.com>\nmailto:a.user@example.com\nB.User@example.com",
    )).toEqual(["a.user@example.com", "b.user@example.com"]);
  });

  it("does not invent an email from a display name", () => {
    expect(extractEmailsFromText("Nguyen Van A\nOrganizer")).toEqual([]);
  });
});
