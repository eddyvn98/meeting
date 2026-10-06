import { describe, expect, it } from "vitest";
import { liveRoomNotificationDedupeKey } from "../../lib/meeting/notificationDedupe";

describe("live-room notification dedupe", () => {
  it("is stable across recipient email casing/whitespace", () => {
    expect(liveRoomNotificationDedupeKey("meeting-1", " Alice@Example.com ")).toBe(
      liveRoomNotificationDedupeKey("meeting-1", "alice@example.com"),
    );
  });

  it("separates meetings and recipients", () => {
    expect(liveRoomNotificationDedupeKey("meeting-1", "a@example.com")).not.toBe(
      liveRoomNotificationDedupeKey("meeting-2", "a@example.com"),
    );
    expect(liveRoomNotificationDedupeKey("meeting-1", "a@example.com")).not.toBe(
      liveRoomNotificationDedupeKey("meeting-1", "b@example.com"),
    );
  });
});
