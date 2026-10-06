export function normalizeTeamsMeetingUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    const allowed = ["teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft"];
    if (
      url.protocol !== "https:" ||
      !allowed.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    ) {
      return null;
    }
    url.hash = "";
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

export function cleanMeetingTitle(value: unknown, fallback = "Teams Meeting"): string {
  if (typeof value !== "string") return fallback;
  const title = value.trim().replace(/\s+/g, " ");
  return title.slice(0, 180) || fallback;
}

export function teamsMeetingIdentity(value: unknown): string | null {
  const normalized = normalizeTeamsMeetingUrl(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    const path = decodeURIComponent(url.pathname)
      .replace(/\/+$/, "")
      .toLowerCase();
    return path ? `${url.hostname.toLowerCase()}${path}` : null;
  } catch {
    return null;
  }
}
