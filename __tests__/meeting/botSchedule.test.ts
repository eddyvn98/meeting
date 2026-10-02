import { describe, expect, it } from "vitest";
import {
  BOT_SCHEDULE_MAX_AHEAD_MS,
  BOT_SCHEDULE_PAST_GRACE_MS,
  parseBotScheduledAt,
} from "@/lib/meeting/bot/schedule";

describe("Meeting bot schedule parsing", () => {
  const now = Date.UTC(2026, 9, 2, 4, 0, 0);

  it("keeps immediate bot requests unscheduled", () => {
    expect(parseBotScheduledAt(undefined, now)).toEqual({ ok: true, scheduledAt: null });
    expect(parseBotScheduledAt("", now)).toEqual({ ok: true, scheduledAt: null });
  });

  it("accepts a future ISO timestamp", () => {
    const value = new Date(now + 10 * 60_000).toISOString();
    const parsed = parseBotScheduledAt(value, now);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.scheduledAt?.toISOString()).toBe(value);
  });

  it("allows the small past grace but rejects stale requests", () => {
    expect(parseBotScheduledAt(new Date(now - BOT_SCHEDULE_PAST_GRACE_MS).toISOString(), now).ok).toBe(true);
    expect(parseBotScheduledAt(new Date(now - BOT_SCHEDULE_PAST_GRACE_MS - 1).toISOString(), now).ok).toBe(false);
  });

  it("rejects malformed and excessively distant timestamps", () => {
    expect(parseBotScheduledAt("not-a-date", now).ok).toBe(false);
    expect(parseBotScheduledAt(new Date(now + BOT_SCHEDULE_MAX_AHEAD_MS + 1).toISOString(), now).ok).toBe(false);
  });
});
