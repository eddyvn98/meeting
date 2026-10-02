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

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function nextWeekday(date: Date): Date {
  let next = addUtcDays(date, 1);
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next = addUtcDays(next, 1);
  return next;
}

function nextMonthly(anchor: Date, current: Date): Date {
  const year = current.getUTCFullYear();
  const month = current.getUTCMonth() + 1;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = month % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(anchor.getUTCDate(), lastDay);
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    anchor.getUTCHours(),
    anchor.getUTCMinutes(),
    anchor.getUTCSeconds(),
    anchor.getUTCMilliseconds(),
  ));
}

export function nextMeetingScheduleRun(
  startAt: Date,
  repeat: MeetingScheduleRepeat,
  currentOccurrence: Date,
): Date | null {
  switch (repeat) {
    case "NONE":
      return null;
    case "DAILY":
      return addUtcDays(currentOccurrence, 1);
    case "WEEKDAYS":
      return nextWeekday(currentOccurrence);
    case "WEEKLY":
      return addUtcDays(currentOccurrence, 7);
    case "BIWEEKLY":
      return addUtcDays(currentOccurrence, 14);
    case "MONTHLY":
      return nextMonthly(startAt, currentOccurrence);
  }
}
