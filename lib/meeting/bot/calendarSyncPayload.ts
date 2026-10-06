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

export function canonicalEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function sanitizeCalendarAttendeeEmails(value: unknown, max = 300): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const email = canonicalEmail(item);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    result.push(email);
    if (result.length >= max) break;
  }
  return result;
}

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
  const botEmail = canonicalEmail(body.botEmail);
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
