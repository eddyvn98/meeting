const EXACT_EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

/** Trims, lower-cases, and validates an email address. */
export function normalizeMeetingEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized && EXACT_EMAIL_PATTERN.test(normalized) ? normalized : null;
}

/** Applies an optional environment-provided domain allowlist in production. */
export function isKnownMeetingUserEmail(email: string | null | undefined): boolean {
  const normalized = normalizeMeetingEmail(email);
  if (!normalized) return false;
  if (process.env.NODE_ENV !== "production") return true;
  const domains = (process.env.MEETING_ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  return domains.some((domain) => normalized.endsWith(`@${domain}`));
}
