const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export const BOT_SCHEDULE_PAST_GRACE_MS = 5 * MINUTE_MS;
export const BOT_SCHEDULE_MAX_AHEAD_MS = 7 * DAY_MS;

export type ParsedBotSchedule =
  | { ok: true; scheduledAt: Date | null }
  | { ok: false; error: string };

/**
 * Parses an optional ISO timestamp supplied by the bot scheduling UI.
 *
 * The small past grace lets a user submit a test that was prepared just
 * before the clock ticked over. The seven-day ceiling prevents accidental
 * long-lived queued sessions while still being generous for QA.
 */
export function parseBotScheduledAt(
  value: unknown,
  nowMs = Date.now(),
): ParsedBotSchedule {
  if (value === undefined || value === null || value === "") {
    return { ok: true, scheduledAt: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "scheduledAt must be an ISO date string." };
  }

  const scheduledAt = new Date(value);
  const scheduledMs = scheduledAt.valueOf();
  if (!Number.isFinite(scheduledMs)) {
    return { ok: false, error: "scheduledAt is not a valid date." };
  }
  if (scheduledMs < nowMs - BOT_SCHEDULE_PAST_GRACE_MS) {
    return { ok: false, error: "The scheduled time is too far in the past." };
  }
  if (scheduledMs > nowMs + BOT_SCHEDULE_MAX_AHEAD_MS) {
    return { ok: false, error: "The scheduled time must be within the next 7 days." };
  }

  return { ok: true, scheduledAt };
}
