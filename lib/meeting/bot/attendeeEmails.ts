const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function canonicalMeetingEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().replace(/^mailto:/i, "").split("?")[0]?.trim().toLowerCase() ?? "";
  return EMAIL_RE.test(email) ? email : null;
}

export function sanitizeMeetingAttendeeEmails(value: unknown, max = 300): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const email = canonicalMeetingEmail(item);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    result.push(email);
    if (result.length >= max) break;
  }
  return result;
}
