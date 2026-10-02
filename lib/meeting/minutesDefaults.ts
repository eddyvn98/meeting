/**
 * lib/meeting/minutesDefaults.ts
 *
 * Suggested "Meeting Date" / "Meeting Time" for a MOM that has no saved
 * MeetingMinutes row yet, rendered in the viewer's own IANA time zone
 * (sent by the browser as `tz`) instead of the server's UTC.
 */

/** Returns `tz` if it is a valid IANA time zone name, else "UTC". */
export function resolveTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export function defaultMeetingDateAndTime(
  meeting: { createdAt: Date; durationSec: number | null },
  timeZone: string | null | undefined,
): { meetingDate: string; timeRange: string | null } {
  const zone = resolveTimeZone(timeZone);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  const start = meeting.createdAt;
  const meetingDate = date.format(start);
  if (!meeting.durationSec) return { meetingDate, timeRange: null };
  const end = new Date(start.getTime() + meeting.durationSec * 1000);
  return { meetingDate, timeRange: `${time.format(start)} - ${time.format(end)}` };
}

/** Browser-side: `tz=<IANA zone>` query string for the viewer's own time zone. */
export function browserTimeZoneQuery(): string {
  try {
    return `tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`;
  } catch {
    return "tz=UTC";
  }
}
