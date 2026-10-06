import { canonicalMeetingEmail, sanitizeMeetingAttendeeEmails } from "./attendeeEmails";

export type CalendarSyncEvent = {
  eventId?: unknown;
  meetingUrl?: unknown;
  title?: unknown;
  scheduledAt?: unknown;
  ownerEmail?: unknown;
  organizerEmail?: unknown;
  attendeeEmails?: unknown;
  organizerAllowed?: unknown;
  invited?: unknown;
  cancelled?: unknown;
  declined?: unknown;
};

export type CalendarSyncPayload = {
  mailboxKey: string;
  botEmail: string;
  windowStart: Date;
  windowEnd: Date;
  events: CalendarSyncEvent[];
};

export function cleanCalendarSyncKey(value: unknown, max = 512): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  return key && key.length <= max ? key : null;
}

export function parseCalendarSyncDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function parseCalendarSyncPayload(value: unknown):
  | { ok: true; payload: CalendarSyncPayload }
  | { ok: false; error: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Invalid JSON body" };
  }
  const body = value as Record<string, unknown>;
  const mailboxKey = cleanCalendarSyncKey(body.mailboxKey, 240);
  const botEmail = canonicalMeetingEmail(body.botEmail);
  const windowStart = parseCalendarSyncDate(body.windowStart);
  const windowEnd = parseCalendarSyncDate(body.windowEnd);
  const events = Array.isArray(body.events) ? body.events as CalendarSyncEvent[] : null;

  if (!mailboxKey || !botEmail || !windowStart || !windowEnd || !events) {
    return {
      ok: false,
      error: "mailboxKey, botEmail, windowStart, windowEnd, and events are required.",
    };
  }
  if (windowEnd <= windowStart) {
    return { ok: false, error: "Calendar sync window is invalid." };
  }
  if (events.length > 1000) {
    return { ok: false, error: "Calendar sync is limited to 1000 events per snapshot." };
  }
  return {
    ok: true,
    payload: { mailboxKey, botEmail, windowStart, windowEnd, events },
  };
}

export function graphCalendarSourceKey(mailboxKey: string, eventId: string, scheduledAt: Date): string {
  return `graph:${mailboxKey}:${eventId}:${scheduledAt.toISOString()}`;
}
