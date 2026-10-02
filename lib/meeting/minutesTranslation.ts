/**
 * lib/meeting/minutesTranslation.ts
 *
 * Language versions of a meeting's minutes. A version is one self-contained
 * document (header + attendance + matters) produced by translating the
 * original, then editable on its own. Names, organizations, dates, statuses
 * and ids are copied as they are; only prose is sent for translation.
 */

import { z } from "zod";
import { parseSectionItems, type AttendanceSectionItem, type MinutesMatter } from "./overviewSections";
import type { MinutesHeaderFields } from "./minutesTypes";
import { MINUTES_LABEL_DEFAULTS, MINUTES_LABEL_KEYS, type MinutesLabelOverrides } from "./minutesLabels";

export interface MinutesDocContent {
  header: MinutesHeaderFields;
  attendance: AttendanceSectionItem[];
  matters: MinutesMatter[];
  /** The fixed wording of this version (headings, table headers, ...), in its language. */
  labels?: MinutesLabelOverrides;
}

/** One saved language version, as the client receives it. */
export interface MinutesTranslation {
  language: string;
  label: string;
  content: MinutesDocContent;
  /** True when the original changed after this version was translated. */
  stale: boolean;
  updatedAt: string;
}

const nullableString = z.string().nullable();

const headerSchema = z.object({
  title: nullableString,
  meetingDate: nullableString,
  timeRange: nullableString,
  venue: nullableString,
  footnote: nullableString,
  recordedBy: nullableString,
  recordedDate: nullableString,
  distributed: nullableString,
});

const contentShapeSchema = z.object({
  header: headerSchema,
  attendance: z.array(z.unknown()),
  matters: z.array(z.unknown()),
  labels: z.record(z.string()).optional(),
});

/** Validates untrusted content (a PATCH body, or a stored row). Items that do
 *  not match their section schema are dropped, like everywhere else. */
export function parseMinutesDocContent(raw: unknown): MinutesDocContent | null {
  const shape = contentShapeSchema.safeParse(raw);
  if (!shape.success) return null;
  return {
    header: shape.data.header,
    attendance: parseSectionItems("attendance", shape.data.attendance) as AttendanceSectionItem[],
    matters: parseSectionItems("minutes_table", shape.data.matters) as MinutesMatter[],
    labels: Object.fromEntries(MINUTES_LABEL_KEYS.filter((key) => typeof shape.data.labels?.[key] === "string").map((key) => [key, shape.data.labels?.[key] as string])),
  };
}

interface Slot {
  text: string;
  set: (translated: string) => void;
}

/** Every piece of prose in `content`, each with a setter that writes the
 *  translation back in place. Order is stable, so lines map back one to one. */
function collectSlots(content: MinutesDocContent): Slot[] {
  const slots: Slot[] = [];
  const add = (text: string | null | undefined, set: (translated: string) => void) => {
    if (text && text.trim()) slots.push({ text, set });
  };

  // The fixed wording starts as the English defaults and is translated with the rest.
  const labels: MinutesLabelOverrides = { ...MINUTES_LABEL_DEFAULTS };
  content.labels = labels;
  for (const key of MINUTES_LABEL_KEYS) {
    add(labels[key], (t) => {
      labels[key] = t;
    });
  }

  for (const key of ["title", "venue", "footnote", "distributed"] as const) {
    add(content.header[key], (t) => {
      content.header[key] = t;
    });
  }
  for (const person of content.attendance) {
    add(person.role, (t) => {
      person.role = t;
    });
  }
  for (const matter of content.matters) {
    add(matter.title, (t) => {
      matter.title = t;
    });
    for (const row of matter.rows) {
      row.discussion.forEach((line, i) =>
        add(line, (t) => {
          row.discussion[i] = t;
        }),
      );
      for (const action of row.actions) {
        add(action.text, (t) => {
          action.text = t;
        });
        add(action.duration, (t) => {
          action.duration = t;
        });
        add(action.deadline, (t) => {
          action.deadline = t;
        });
      }
    }
  }
  return slots;
}

export type TranslateLines = (lines: string[]) => Promise<(string | null)[] | null>;

/** Returns a translated copy of `source`. Throws when the translation service
 *  is unavailable or returns almost nothing, so a version is never saved as a
 *  copy of the original with a few words changed. */
export async function translateMinutesContent(source: MinutesDocContent, translate: TranslateLines): Promise<MinutesDocContent> {
  const copy = structuredClone(source);
  const slots = collectSlots(copy);
  if (slots.length === 0) return copy;

  const translated = await translate(slots.map((s) => s.text));
  if (!translated) throw new Error("Translation is unavailable right now");

  let done = 0;
  slots.forEach((slot, i) => {
    const text = translated[i];
    if (text && text.trim()) {
      slot.set(text);
      done += 1;
    }
  });
  if (done < slots.length / 2) throw new Error("Translation failed for most of the minutes. Try again.");
  return copy;
}
