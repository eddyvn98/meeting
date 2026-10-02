/**
 * lib/meeting/translateSummary.ts
 *
 * Flattens a MeetingSummary's translatable text into one ordered string list
 * (so translate/route.ts can translate them in the SAME batched agent call as
 * the transcript segments — one "Translate" action must cover the whole
 * meeting, not just the raw script) and splits the translated results back
 * into the same shape, keyed by section/item id so the client can apply them
 * without caring about array order.
 *
 * Covers: overview text, topic titles, and every dynamic OverviewSection —
 * both its title and the translatable fields of its items (per kind: `text`,
 * `task`, `question`/`answer`, `option`/`pros`/`cons`, `label`, etc.). Fields
 * that are data rather than prose — owner, deadline, done, ids, evidence
 * segment ids, metric `value` — are never queued for translation.
 */

import { parseSectionItems, type MinutesMatter, type OverviewSectionKind, type SectionItem } from "./overviewSections";

export interface SummarySectionLike {
  id: string;
  kind: string;
  title: string;
  items: unknown[];
}

export interface SummaryLike {
  overview: string;
  topics: { id: string; title: string }[];
  sections: SummarySectionLike[];
}

/** Translated fields for one item, keyed by whichever of these apply to its
 *  kind — the client applies only the keys present for that item's kind. */
export interface TranslatedItemFields {
  text?: string;
  task?: string;
  question?: string;
  answer?: string;
  option?: string;
  pros?: string[];
  cons?: string[];
  label?: string;
  /** `minutes_table` matter title only — its `rows` are queued separately
   *  as `TranslatedMinutesRowFields` (see below), since a matter's item id
   *  doesn't carry per-row/per-action translated text. */
  title?: string;
}

/** Translated fields for one `minutes_table` row's translatable strings —
 *  `discussion` bullets and each action's `text`. Names (`responsible`) and
 *  data fields (`duration`, `deadline`, `ongoing`) are never queued for
 *  translation. Keyed by the row's own id inside
 *  `TranslatedSectionFields.minutesRows` (a matter's rows aren't top-level
 *  section items, so they can't share the `items` map keyed by item id). */
export interface TranslatedMinutesRowFields {
  discussion: string[];
  actions: Record<string, string>;
}

export interface TranslatedSectionFields {
  title: string | null;
  items: Record<string, TranslatedItemFields>;
  /** `minutes_table` only — per-matter-row translated fields, keyed by row
   *  id (see TranslatedMinutesRowFields). Empty for every other kind. */
  minutesRows: Record<string, TranslatedMinutesRowFields>;
}

export interface TranslatedSummaryFields {
  overview: string | null;
  topics: Record<string, string>;
  sections: Record<string, TranslatedSectionFields>;
}

/** One line queued for translation, in emission order, and how to write its
 *  translated result back into the output structure being built. Both
 *  buildSummaryTranslationLines and splitSummaryTranslations walk `summary`
 *  through `collectSlots` so the two can never drift out of order with each
 *  other — the line list IS the slot list's `.text`s. */
interface TranslationSlot {
  text: string;
  apply: (translated: string) => void;
}

function pushTextSlot(slots: TranslationSlot[], text: string, apply: (translated: string) => void) {
  if (!text) return;
  slots.push({ text, apply });
}

function pushArraySlot(slots: TranslationSlot[], values: string[], apply: (index: number, translated: string) => void) {
  values.forEach((value, index) => pushTextSlot(slots, value, (translated) => apply(index, translated)));
}

/** Queues every translatable string in one section's items into `fields`,
 *  keyed by item id — mirrors overviewSections.ts's per-kind item shapes.
 *  `fields` objects are pre-populated with the item's own (untranslated)
 *  array values for pros/cons so a partial translation (some lines skipped
 *  by the agent) still returns a complete, valid array rather than gaps. */
/** Queues one `minutes_table` matter's rows (discussion bullets + each
 *  action's `text`) into `minutesRows`, keyed by row id — split out from
 *  queueSectionItems because a matter's translatable strings live two
 *  levels deep (matter -> row -> discussion/actions), unlike every other
 *  kind's flat item fields. Names (`responsible`) and data fields
 *  (`duration`, `deadline`, `ongoing`) are intentionally never queued. */
function queueMinutesMatterRows(slots: TranslationSlot[], matter: MinutesMatter, minutesRows: Record<string, TranslatedMinutesRowFields>) {
  for (const row of matter.rows) {
    const rowFields: TranslatedMinutesRowFields = { discussion: [...row.discussion], actions: {} };
    minutesRows[row.id] = rowFields;
    pushArraySlot(slots, row.discussion, (i, t) => (rowFields.discussion[i] = t));
    for (const action of row.actions) {
      pushTextSlot(slots, action.text, (t) => (rowFields.actions[action.id] = t));
    }
  }
}

function queueSectionItems(
  slots: TranslationSlot[],
  kind: string,
  rawItems: unknown[],
  itemFields: Record<string, TranslatedItemFields>,
  minutesRows: Record<string, TranslatedMinutesRowFields>,
) {
  const items = parseSectionItems(kind as OverviewSectionKind, rawItems) as SectionItem[];
  for (const item of items) {
    const fields: TranslatedItemFields = {};
    itemFields[item.id] = fields;

    // attendance: name/role/status are data, not prose — nothing to queue.
    if ("text" in item) pushTextSlot(slots, item.text, (t) => (fields.text = t));
    if ("task" in item) pushTextSlot(slots, item.task, (t) => (fields.task = t));
    if ("question" in item) pushTextSlot(slots, item.question, (t) => (fields.question = t));
    if ("answer" in item) pushTextSlot(slots, item.answer, (t) => (fields.answer = t));
    if ("option" in item) pushTextSlot(slots, item.option, (t) => (fields.option = t));
    if ("label" in item) pushTextSlot(slots, item.label, (t) => (fields.label = t));
    if ("pros" in item) {
      const pros = [...item.pros];
      fields.pros = pros;
      pushArraySlot(slots, item.pros, (i, t) => (pros[i] = t));
    }
    if ("cons" in item) {
      const cons = [...item.cons];
      fields.cons = cons;
      pushArraySlot(slots, item.cons, (i, t) => (cons[i] = t));
    }
    if ("rows" in item) {
      // minutes_table matter: title + each row's discussion/actions.
      pushTextSlot(slots, item.title, (t) => (fields.title = t));
      queueMinutesMatterRows(slots, item, minutesRows);
    }
  }
}

/** Builds the flat, ordered TranslationSlot list for `summary`: overview,
 *  then topic titles, then each section's title + its items' translatable
 *  fields, in section/item order. `result` is filled in with mutable
 *  placeholder objects the slots' `apply` closures write into — callers that
 *  only need the line list (buildSummaryTranslationLines) can discard it. */
function collectSlots(summary: SummaryLike): { slots: TranslationSlot[]; result: TranslatedSummaryFields } {
  const slots: TranslationSlot[] = [];
  const result: TranslatedSummaryFields = { overview: null, topics: {}, sections: {} };

  pushTextSlot(slots, summary.overview, (t) => (result.overview = t));

  for (const topic of summary.topics) {
    pushTextSlot(slots, topic.title, (t) => (result.topics[topic.id] = t));
  }

  for (const section of summary.sections) {
    const fields: TranslatedSectionFields = { title: null, items: {}, minutesRows: {} };
    result.sections[section.id] = fields;
    pushTextSlot(slots, section.title, (t) => (fields.title = t));
    queueSectionItems(slots, section.kind, section.items, fields.items, fields.minutesRows);
  }

  return { slots, result };
}

/** Order here MUST match splitSummaryTranslations' consumption order (both
 *  derive from collectSlots, so they can't drift). */
export function buildSummaryTranslationLines(summary: SummaryLike): string[] {
  return collectSlots(summary).slots.map((slot) => slot.text);
}

/** `translations` must be exactly the array generateTranslations() returned
 *  for the lines buildSummaryTranslationLines() produced, in the same
 *  order — position (not content) is how alignment works, same contract as
 *  the transcript's own translation split. */
export function splitSummaryTranslations(summary: SummaryLike, translations: (string | null)[]): TranslatedSummaryFields {
  const { slots, result } = collectSlots(summary);
  slots.forEach((slot, i) => {
    const translated = translations[i] ?? null;
    if (translated) slot.apply(translated);
  });
  return result;
}
