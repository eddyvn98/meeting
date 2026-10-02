/**
 * lib/meeting/shareTypes.ts
 *
 * Stage C: meeting sharing role. Kept out of lib/meeting/types.ts (already
 * near its 300-line guard, per AGENTS.md) — this feature's own type lives
 * here instead, mirroring how lib/meeting/minutesTypes.ts holds Stage B's
 * UI-only shapes.
 */

/** Lower-case wire form matching app/api/meeting/_access.ts's
 *  MeetingAccessRole ("owner" | "editor" | "viewer" | null) minus "owner" —
 *  a MeetingShare row is always one of these two, never "owner". */
export type MeetingShareRole = "viewer" | "editor";
