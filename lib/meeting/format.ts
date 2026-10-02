/**
 * lib/meeting/format.ts
 *
 * Small display-formatting helpers shared by the Meeting Result screen
 * components (`app/(tools)/meeting/[meetingId]/components/**`). Kept separate
 * from `lib/meeting/types.ts` / `serialize.ts` (owned by the data-model
 * agent) — this file only formats already-serialized API data for display.
 */

/** "3:05" / "1:02:03" style clock from a millisecond offset. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "45 min" / "1h 5m" style duration from a second count. */
export function formatDurationSec(sec: number | null): string {
  if (sec == null) return "—";
  const totalMinutes = Math.round(sec / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes} min`;
}

/** "Sep 7, 2026" style date from an ISO 8601 string. */
export function formatDateLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Same-day-key helper for grouping a list of ISO timestamps by calendar day
 *  (local time) — e.g. the sidebar's Recent list (MeetingAside.tsx). */
export function dayKeyOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** "Today" / "Yesterday" / formatDateLabel — the group header shown above a
 *  day's meetings in the sidebar's Recent list. */
export function formatDayGroupLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return formatDateLabel(iso);
}

/** Short due-date label for Action Item rows, e.g. "Sep 10". Falls back to
 *  the raw string if it isn't parseable (deadline may be free text). */
export function formatDeadline(deadline: string | null): string | null {
  if (!deadline) return null;
  const date = new Date(deadline);
  if (Number.isNaN(date.getTime())) return deadline;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Up-to-2-letter initials from a person's name/owner string. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Cosmetic (non-semantic) rotating avatar palette — Tailwind raw colors are
 *  fine here per the spec's Design Tokens note (avatar backgrounds rotate
 *  per person, they don't carry meaning). */
const AVATAR_PALETTE = [
  "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300",
  "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300",
];

export function avatarPaletteFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
