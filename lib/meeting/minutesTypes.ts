/**
 * lib/meeting/minutesTypes.ts
 *
 * UI-only shapes for the MOM (Minutes of Meeting) editor (Stage B). Kept
 * out of lib/meeting/types.ts on purpose — that file is close to its
 * 300-line guard and this feature's own types don't need to live in the
 * shared cross-module file; see the Stage B task notes.
 */

import type { MeetingMinutes } from "./types";

/** The editable header/footer fields on MeetingMinutes — every field PATCH
 *  .../minutes accepts except the read-only id/meetingId/timestamps and
 *  the computed `attendanceSuggestions`/`isDefault`. */
export type MinutesHeaderFields = Pick<
  MeetingMinutes,
  "title" | "meetingDate" | "timeRange" | "venue" | "footnote" | "recordedBy" | "recordedDate" | "distributed"
>;

export const MINUTES_HEADER_FIELD_KEYS: (keyof MinutesHeaderFields)[] = [
  "title",
  "meetingDate",
  "timeRange",
  "venue",
  "footnote",
  "recordedBy",
  "recordedDate",
  "distributed",
];

/** POST /api/meeting/[meetingId]/minutes/generate body. */
export interface GenerateMinutesInput {
  confirmReplace?: boolean;
}
