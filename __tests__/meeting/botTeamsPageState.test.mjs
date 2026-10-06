import { describe, expect, it, vi } from "vitest";
import { readTeamsPage } from "../../scripts/meeting-bot-teams.mjs";

function fakePage({ body, joined }) {
  return {
    isClosed: () => false,
    url: () => "https://teams.microsoft.com/v2/",
    locator: vi.fn(() => ({
      innerText: vi.fn(async () => body),
    })),
    getByRole: vi.fn(() => ({
      first() {
        return this;
      },
      isVisible: vi.fn(async () => joined),
    })),
  };
}

describe("Teams page state priority", () => {
  it("prefers a visible in-call control over stale removal text", async () => {
    const page = fakePage({
      body: "You've been removed from the meeting",
      joined: true,
    });
    await expect(readTeamsPage(page)).resolves.toEqual({
      state: "JOINED",
      body: "You've been removed from the meeting",
    });
  });

  it("uses status text when no in-call control is visible", async () => {
    const page = fakePage({
      body: "You've been removed from the meeting",
      joined: false,
    });
    await expect(readTeamsPage(page)).resolves.toEqual({
      state: "REMOVED",
      body: "You've been removed from the meeting",
    });
  });
});
