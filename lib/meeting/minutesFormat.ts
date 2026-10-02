/**
 * lib/meeting/minutesFormat.ts
 *
 * Pure display-formatting helpers for the MOM (Minutes of Meeting) editor
 * (Stage B — app/(tools)/meeting/[meetingId]/minutes/**). Kept separate
 * from lib/meeting/format.ts (owned by the Meeting Result screen) and from
 * lib/meeting/types.ts (which Stage B must not edit — see AGENTS.md/spec)
 * so both sides can evolve independently.
 */

import type { MinutesActionItem } from "./overviewSections";

/** Renders an action's "(Duration, Deadline)" / "(Ongoing)" suffix — the
 *  parenthetical shown after an action's text in the MOM layout's Action
 *  column, e.g. "(1 week, 29/5/26)" or "(Ongoing)". Returns "" when the
 *  action has neither a duration, a deadline, nor `ongoing` set, so the
 *  caller can skip rendering an empty "()" pair. `ongoing` takes priority
 *  over any duration/deadline text a row might also carry (a stray value
 *  left over from before the action was marked ongoing shouldn't leak back
 *  into the displayed text). */
export function formatActionParenthetical(action: Pick<MinutesActionItem, "duration" | "deadline" | "ongoing">, ongoingLabel = "Ongoing"): string {
  if (action.ongoing) return `(${ongoingLabel})`;
  const parts = [action.duration, action.deadline].filter((v): v is string => Boolean(v && v.trim()));
  if (parts.length === 0) return "";
  return `(${parts.join(", ")})`;
}

/** Joins a `responsible` string array into the single display line the MOM
 *  layout shows in the Responsible column, e.g. ["Alice", "Bob"] ->
 *  "Alice, Bob". Empty/blank entries are dropped. */
export function formatResponsibleList(responsible: string[]): string {
  return responsible.map((r) => r.trim()).filter(Boolean).join(", ");
}

/** Splits a comma-separated free-text field (the "Responsible" chip input)
 *  back into a clean string array — inverse of formatResponsibleList, minus
 *  the trailing empty entry a trailing comma would otherwise leave behind. */
export function parseResponsibleInput(value: string): string[] {
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

/** "S/N" column numbering: 1-based index of `matterIndex` in the matters
 *  array, as a display string. Kept as a function (not just `index + 1`
 *  inline) so a future change to the numbering scheme (e.g. "1.", "A.")
 *  only touches one place. */
export function formatMatterNumber(matterIndex: number): string {
  return String(matterIndex + 1);
}
