/**
 * lib/meeting/minutesSource.ts
 *
 * Loads a meeting's ORIGINAL minutes as one MinutesDocContent, and the moment
 * it was last changed (for "this translation is out of date" checks).
 */

import { prisma } from "@/lib/prisma";
import type { Meeting, MeetingMinutesTranslation as PrismaTranslation } from "@prisma/client";
import { parseSectionItems, type AttendanceSectionItem, type MinutesMatter } from "./overviewSections";
import { defaultMeetingDateAndTime } from "./minutesDefaults";
import { parseMinutesDocContent, type MinutesDocContent, type MinutesTranslation } from "./minutesTranslation";
import { labelForTranslateLang } from "./translateLanguages";

export async function loadOriginalMinutes(meeting: Meeting, timeZone: string | null): Promise<{ content: MinutesDocContent; updatedAt: Date }> {
  const [row, summary] = await Promise.all([
    prisma.meetingMinutes.findUnique({ where: { meetingId: meeting.id } }),
    prisma.meetingSummary.findUnique({ where: { meetingId: meeting.id }, include: { sections: true } }),
  ]);
  const attendanceSection = summary?.sections.find((s) => s.kind === "attendance");
  const mattersSection = summary?.sections.find((s) => s.kind === "minutes_table");

  const defaults = defaultMeetingDateAndTime(meeting, timeZone);
  const header = row
    ? {
        title: row.title,
        meetingDate: row.meetingDate,
        timeRange: row.timeRange,
        venue: row.venue,
        footnote: row.footnote,
        recordedBy: row.recordedBy,
        recordedDate: row.recordedDate,
        distributed: row.distributed,
      }
    : {
        title: `MINUTES OF ${meeting.title.toUpperCase()}`,
        meetingDate: defaults.meetingDate,
        timeRange: defaults.timeRange,
        venue: null,
        footnote: null,
        recordedBy: null,
        recordedDate: null,
        distributed: null,
      };

  const stamps = [row?.updatedAt, attendanceSection?.updatedAt, mattersSection?.updatedAt].filter((d): d is Date => d instanceof Date);
  return {
    content: {
      header,
      attendance: parseSectionItems("attendance", attendanceSection?.items) as AttendanceSectionItem[],
      matters: parseSectionItems("minutes_table", mattersSection?.items) as MinutesMatter[],
    },
    updatedAt: stamps.length > 0 ? new Date(Math.max(...stamps.map((d) => d.getTime()))) : new Date(0),
  };
}

/** Shapes a stored row for the client, flagging it stale when the original
 *  changed after it was translated. */
export function toClientTranslation(row: PrismaTranslation, originalUpdatedAt: Date): MinutesTranslation | null {
  const content = parseMinutesDocContent(row.content);
  if (!content) return null;
  return {
    language: row.language,
    label: labelForTranslateLang(row.language),
    content,
    // A second of slack: the original and the translation are saved a moment apart.
    stale: originalUpdatedAt.getTime() > row.sourceUpdatedAt.getTime() + 1000,
    updatedAt: row.updatedAt.toISOString(),
  };
}
