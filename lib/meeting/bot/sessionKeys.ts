const OCCURRENCE_RE =
  /^(.*):(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)(?::continuation:.*)?$/;

export function rootBotSourceKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(OCCURRENCE_RE);
  if (!match) return value;
  return `${match[1]}:${match[2]}`;
}

export function botSourceOccurrenceAt(
  value: string | null | undefined,
): Date | null {
  if (!value) return null;
  const match = value.match(OCCURRENCE_RE);
  if (!match) return null;
  const date = new Date(match[2]);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function sameBotOccurrence(
  value: string | null | undefined,
  scheduledAt: Date,
  windowMs = 10 * 60_000,
): boolean {
  const occurrence = botSourceOccurrenceAt(value);
  return Boolean(
    occurrence &&
    Math.abs(occurrence.getTime() - scheduledAt.getTime()) <= windowMs,
  );
}
