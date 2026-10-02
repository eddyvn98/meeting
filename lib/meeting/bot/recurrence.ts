export const MEETING_SCHEDULE_REPEATS = [
  "NONE",
  "DAILY",
  "WEEKDAYS",
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
] as const;

export type MeetingScheduleRepeat = (typeof MEETING_SCHEDULE_REPEATS)[number];

export function isMeetingScheduleRepeat(value: unknown): value is MeetingScheduleRepeat {
  return typeof value === "string" && MEETING_SCHEDULE_REPEATS.includes(value as MeetingScheduleRepeat);
}

function toLocalClock(date: Date, timezoneOffsetMin: number): Date {
  return new Date(date.getTime() - timezoneOffsetMin * 60_000);
}

function fromLocalClock(date: Date, timezoneOffsetMin: number): Date {
  return new Date(date.getTime() + timezoneOffsetMin * 60_000);
}

function addLocalDays(date: Date, days: number, timezoneOffsetMin: number): Date {
  const local = toLocalClock(date, timezoneOffsetMin);
  local.setUTCDate(local.getUTCDate() + days);
  return fromLocalClock(local, timezoneOffsetMin);
}

function nextWeekday(date: Date, timezoneOffsetMin: number): Date {
  let next = addLocalDays(date, 1, timezoneOffsetMin);
  while (true) {
    const local = toLocalClock(next, timezoneOffsetMin);
    const day = local.getUTCDay();
    if (day !== 0 && day !== 6) return next;
    next = addLocalDays(next, 1, timezoneOffsetMin);
  }
}

function nextMonthly(anchor: Date, current: Date, timezoneOffsetMin: number): Date {
  const localAnchor = toLocalClock(anchor, timezoneOffsetMin);
  const localCurrent = toLocalClock(current, timezoneOffsetMin);
  const month = localCurrent.getUTCMonth() + 1;
  const targetYear = localCurrent.getUTCFullYear() + Math.floor(month / 12);
  const targetMonth = month % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(localAnchor.getUTCDate(), lastDay);
  const localTarget = new Date(Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    localAnchor.getUTCHours(),
    localAnchor.getUTCMinutes(),
    localAnchor.getUTCSeconds(),
    localAnchor.getUTCMilliseconds(),
  ));
  return fromLocalClock(localTarget, timezoneOffsetMin);
}

export function nextMeetingScheduleRun(
  startAt: Date,
  repeat: MeetingScheduleRepeat,
  currentOccurrence: Date,
  timezoneOffsetMin = 0,
): Date | null {
  switch (repeat) {
    case "NONE":
      return null;
    case "DAILY":
      return addLocalDays(currentOccurrence, 1, timezoneOffsetMin);
    case "WEEKDAYS":
      return nextWeekday(currentOccurrence, timezoneOffsetMin);
    case "WEEKLY":
      return addLocalDays(currentOccurrence, 7, timezoneOffsetMin);
    case "BIWEEKLY":
      return addLocalDays(currentOccurrence, 14, timezoneOffsetMin);
    case "MONTHLY":
      return nextMonthly(startAt, currentOccurrence, timezoneOffsetMin);
  }
}

export function nextMeetingScheduleAtOrAfter(
  startAt: Date,
  repeat: MeetingScheduleRepeat,
  from: Date,
  timezoneOffsetMin = 0,
): Date | null {
  if (startAt.getTime() >= from.getTime()) return new Date(startAt);
  if (repeat === "NONE") return null;

  let current = new Date(startAt);
  for (let i = 0; i < 5000 && current.getTime() < from.getTime(); i += 1) {
    const next = nextMeetingScheduleRun(startAt, repeat, current, timezoneOffsetMin);
    if (!next) return null;
    current = next;
  }
  return current.getTime() >= from.getTime() ? current : null;
}
