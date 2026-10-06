import { normalizeTeamsMeetingUrl } from "./teamsUrl";

export interface ParsedTeamsInvitation {
  meetingUrl: string | null;
  title: string | null;
  startLocal: string | null;
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const NOISE = [
  /microsoft teams/i,
  /join (the )?meeting/i,
  /tham gia (cuộc )?họp/i, // vi-allow
  /meeting id/i,
  /passcode/i,
  /need help/i,
  /dial[- ]in/i,
  /conference id/i,
  /^from\s*:/i,
  /^sent\s*:/i,
  /^to\s*:/i,
  /^cc\s*:/i,
  /^when\s*:/i,
  /^where\s*:/i,
  /organizer/i,
  /________________________________________________________________/i,
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function localValue(year: number, month: number, day: number, hour: number, minute: number): string | null {
  if (
    year < 2000 || year > 2100 ||
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour < 0 || hour > 23 ||
    minute < 0 || minute > 59
  ) return null;
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

function parseClock(hourRaw: string, minuteRaw: string, meridiemRaw?: string): [number, number] | null {
  let hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const meridiem = meridiemRaw?.toLowerCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? [hour, minute] : null;
}

function findStartLocal(text: string): string | null {
  const whenLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^when\s*:/i.test(line));
  if (whenLine) {
    const preferred = findStartLocal(whenLine.replace(/^when\s*:\s*/i, ""));
    if (preferred) return preferred;
  }

  const time = text.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
  if (!time) return null;
  const clock = parseClock(time[1], time[2], time[3]);
  if (!clock) return null;

  const monthFirst = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(20\d{2})\b/i,
  );
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase()];
    return localValue(Number(monthFirst[3]), month, Number(monthFirst[2]), clock[0], clock[1]);
  }

  const dayFirst = text.match(
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec),?\s+(20\d{2})\b/i,
  );
  if (dayFirst) {
    const month = MONTHS[dayFirst[2].toLowerCase()];
    return localValue(Number(dayFirst[3]), month, Number(dayFirst[1]), clock[0], clock[1]);
  }

  // Numeric invitations are interpreted day/month/year, matching the primary
  // deployment locale. ISO yyyy-mm-dd is handled separately to avoid ambiguity.
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return localValue(Number(iso[1]), Number(iso[2]), Number(iso[3]), clock[0], clock[1]);

  const numeric = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);
  if (numeric) return localValue(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]), clock[0], clock[1]);

  return null;
}

function findMeetingUrl(text: string): string | null {
  const candidates = text.match(/https:\/\/[^\s<>"']+/gi) ?? [];
  for (const raw of candidates) {
    const candidate = raw.replace(/[),.;\]]+$/, "");
    const normalized = normalizeTeamsMeetingUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function looksLikeDateOrTime(line: string): boolean {
  return /\b20\d{2}\b/.test(line) && (
    /\b\d{1,2}:\d{2}\b/.test(line) ||
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/i.test(line) ||
    /\b\d{1,2}[\/-]\d{1,2}[\/-]20\d{2}\b/.test(line)
  );
}

function findTitle(text: string, meetingUrl: string | null): string | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const subject = lines.find((line) => /^subject\s*:/i.test(line));
  if (subject) {
    const value = subject.replace(/^subject\s*:\s*/i, "").trim().replace(/\s+/g, " ");
    if (value) return value.slice(0, 180);
  }

  for (const line of lines) {
    if (meetingUrl && line.includes(meetingUrl)) continue;
    if (/https:\/\//i.test(line)) continue;
    if (looksLikeDateOrTime(line)) continue;
    if (NOISE.some((pattern) => pattern.test(line))) continue;
    if (line.length > 180) continue;
    return line.replace(/\s+/g, " ");
  }
  return null;
}

export function parseTeamsInvitation(text: string): ParsedTeamsInvitation {
  const raw = text.trim();
  if (!raw) return { meetingUrl: null, title: null, startLocal: null };
  const meetingUrl = findMeetingUrl(raw);
  return {
    meetingUrl,
    title: findTitle(raw, meetingUrl),
    startLocal: findStartLocal(raw),
  };
}
