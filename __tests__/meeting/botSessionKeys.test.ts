import { describe, expect, it } from "vitest";
import {
  botSourceOccurrenceAt,
  rootBotSourceKey,
  sameBotOccurrence,
} from "@/lib/meeting/bot/sessionKeys";

describe("meeting bot source keys", () => {
  it("extracts the root occurrence from nested continuations", () => {
    const root = "schedule-1:2026-10-05T02:00:00.000Z";
    const nested =
      root +
      ":continuation:session-a" +
      ":continuation:session-b";

    expect(rootBotSourceKey(nested)).toBe(root);
    expect(botSourceOccurrenceAt(nested)?.toISOString()).toBe(
      "2026-10-05T02:00:00.000Z",
    );
  });

  it("handles Graph keys even when the event id contains colons", () => {
    const key =
      "graph:meetingbot@example.com:event:with:colons:" +
      "2026-10-05T02:00:00.000Z:continuation:session-a";

    expect(rootBotSourceKey(key)).toBe(
      "graph:meetingbot@example.com:event:with:colons:2026-10-05T02:00:00.000Z",
    );
  });

  it("matches only occurrences inside the dedupe window", () => {
    const key = "schedule-1:2026-10-05T02:00:00.000Z:continuation:session-a";
    expect(
      sameBotOccurrence(key, new Date("2026-10-05T02:05:00.000Z")),
    ).toBe(true);
    expect(
      sameBotOccurrence(key, new Date("2026-10-05T02:20:00.000Z")),
    ).toBe(false);
  });
});
