/**
 * lib/meeting/overviewSections.ts
 *
 * Step 1 of the "dynamic overview" feature: the fixed library of section
 * "kinds" a MeetingOverviewSection row can be, plus per-kind item schemas
 * and a safe parser. `MeetingOverviewSection.items` is untyped JSON at the
 * DB layer (see prisma/schema.prisma) — everything that reads it MUST go
 * through `parseSectionItems` so a malformed or legacy row degrades to an
 * empty list instead of throwing and breaking the whole Overview tab.
 *
 * The kind library is intentionally small and closed (no free-form kinds)
 * so the UI can keep a fixed kind -> renderer registry
 * (MeetingOverviewTab.tsx) — a future "AI picks sections" step chooses from
 * this same list, it doesn't invent new ones.
 */

import { z } from "zod";

export const OVERVIEW_SECTION_KINDS = [
  "key_points",
  "actions",
  "decisions",
  "blockers",
  "risks",
  "open_questions",
  "qa",
  "options_compare",
  "feedback",
  "metrics",
  "quotes",
  "custom_text",
  "attendance",
  "minutes_table",
] as const;

export type OverviewSectionKind = (typeof OVERVIEW_SECTION_KINDS)[number];

export function isOverviewSectionKind(value: unknown): value is OverviewSectionKind {
  return typeof value === "string" && (OVERVIEW_SECTION_KINDS as readonly string[]).includes(value);
}

/** Default English title shown when a section is created without one
 *  (e.g. legacy backfill, or an AI/user section that didn't set a title). */
export const DEFAULT_SECTION_TITLES: Record<OverviewSectionKind, string> = {
  key_points: "Key Points",
  actions: "Action Items",
  decisions: "Decisions",
  blockers: "Blockers",
  risks: "Risks",
  open_questions: "Open Questions",
  qa: "Q&A",
  options_compare: "Options Compared",
  feedback: "Feedback",
  metrics: "Metrics",
  quotes: "Quotes",
  custom_text: "Notes",
  attendance: "Attendance",
  minutes_table: "Minutes",
};

const evidenceSegmentIds = z.array(z.string()).default([]);

/** Shared shape for the simple "list of text lines" kinds: key_points,
 *  risks, feedback, quotes, custom_text. */
const textItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  evidenceSegmentIds,
});
export type TextSectionItem = z.infer<typeof textItemSchema>;

const actionItemSchema = z.object({
  id: z.string().min(1),
  task: z.string().min(1),
  owner: z.string().nullable().default(null),
  deadline: z.string().nullable().default(null),
  done: z.boolean().default(false),
  evidenceSegmentIds,
});
export type ActionSectionItem = z.infer<typeof actionItemSchema>;

const qaItemSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().default(""),
  evidenceSegmentIds,
});
export type QaSectionItem = z.infer<typeof qaItemSchema>;

const optionsCompareItemSchema = z.object({
  id: z.string().min(1),
  option: z.string().min(1),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  evidenceSegmentIds,
});
export type OptionsCompareSectionItem = z.infer<typeof optionsCompareItemSchema>;

const metricItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  value: z.string().min(1),
  evidenceSegmentIds,
});
export type MetricSectionItem = z.infer<typeof metricItemSchema>;

/** MOM (Minutes of Meeting) `attendance` kind: one attendee row. `role` is
 *  free text (e.g. "Chair", "Secretary") set manually or remembered from a
 *  past meeting (see MeetingPersonRole in prisma/schema.prisma); `status`
 *  is null until the owner marks it (present ✔ / regrets ✗ in the MOM
 *  layout) — never defaulted to "present" so an unset row is visibly
 *  distinct from an explicit present. */
const attendanceItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().nullable().default(null),
  /** Organization the attendee belongs to, shown after the role column. */
  organization: z.string().nullable().default(null),
  status: z.enum(["present", "regrets"]).nullable().default(null),
});
export type AttendanceSectionItem = z.infer<typeof attendanceItemSchema>;

/** One action row under a `minutes_table` matter — "Action to be taken
 *  (Duration, Deadline)" column in the MOM layout. `duration`/`deadline`
 *  are free-text labels (not parsed dates) since MOM durations are commonly
 *  written as "2 weeks" / "ASAP" rather than an ISO period; `ongoing` marks
 *  an action with no fixed deadline (shown as "Ongoing" instead of a date). */
const minutesActionItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  duration: z.string().nullable().default(null),
  deadline: z.string().nullable().default(null),
  ongoing: z.boolean().default(false),
});
export type MinutesActionItem = z.infer<typeof minutesActionItemSchema>;

/** One row under a matter: a discussion point plus the action(s) and
 *  responsible person(s) it produced. `discussion` and `responsible` are
 *  string arrays (bullets / multiple names) rather than a single string, to
 *  match the MOM layout's multi-line table cells. */
const minutesRowSchema = z.object({
  id: z.string().min(1),
  discussion: z.array(z.string()).default([]),
  actions: z.array(minutesActionItemSchema).default([]),
  responsible: z.array(z.string()).default([]),
  evidenceSegmentIds,
});
export type MinutesRow = z.infer<typeof minutesRowSchema>;

/** `minutes_table` items are numbered "matters" (full-width bold heading
 *  rows in the MOM layout), each containing one or more rows. */
const minutesMatterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  rows: z.array(minutesRowSchema).default([]),
});
export type MinutesMatter = z.infer<typeof minutesMatterSchema>;

/** Per-kind item schema. `open_questions` reuses the text shape (a question
 *  is just its text; the dedicated `qa` kind is for question+answer pairs). */
const SECTION_ITEM_SCHEMAS: Record<OverviewSectionKind, z.ZodTypeAny> = {
  key_points: textItemSchema,
  actions: actionItemSchema,
  decisions: textItemSchema,
  blockers: textItemSchema,
  risks: textItemSchema,
  open_questions: textItemSchema,
  qa: qaItemSchema,
  options_compare: optionsCompareItemSchema,
  feedback: textItemSchema,
  metrics: metricItemSchema,
  quotes: textItemSchema,
  custom_text: textItemSchema,
  attendance: attendanceItemSchema,
  minutes_table: minutesMatterSchema,
};

export type SectionItem =
  | TextSectionItem
  | ActionSectionItem
  | QaSectionItem
  | OptionsCompareSectionItem
  | MetricSectionItem
  | AttendanceSectionItem
  | MinutesMatter;

/** Parses `MeetingOverviewSection.items` (raw JSON from Prisma) for a given
 *  kind. Never throws: an item that fails its schema is dropped rather than
 *  aborting the whole section, and a non-array `raw` returns `[]`. */
export function parseSectionItems(kind: OverviewSectionKind, raw: unknown): SectionItem[] {
  if (!Array.isArray(raw)) return [];
  const schema = SECTION_ITEM_SCHEMAS[kind];
  const result: SectionItem[] = [];
  for (const entry of raw) {
    const parsed = schema.safeParse(entry);
    if (parsed.success) result.push(parsed.data as SectionItem);
  }
  return result;
}

/** Browser- and server-safe id generator for a section item created without
 *  one (manual "Add item" in the editor UI, or a POST body that omits it) —
 *  deliberately not Node's `crypto` module so this file (imported by both
 *  API routes and client components) never pulls in a server-only polyfill. */
function generateItemId(): string {
  return `item_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface SectionItemsValidation {
  ok: boolean;
  items: SectionItem[];
  error: string | null;
}

/** Validates a manual-edit `items` payload (POST/PATCH .../sections) against
 *  the kind's schema — unlike `parseSectionItems` (which silently drops bad
 *  entries so a malformed DB row never breaks rendering), this is STRICT: any
 *  entry that fails validation rejects the whole write with a 400, since the
 *  caller can fix its own input. An entry missing `id` gets one generated
 *  server-side (the editor UI can add items without inventing ids itself). */
export function validateSectionItemsForWrite(kind: OverviewSectionKind, raw: unknown): SectionItemsValidation {
  if (!Array.isArray(raw)) return { ok: false, items: [], error: "items must be an array" };
  const schema = SECTION_ITEM_SCHEMAS[kind];
  const items: SectionItem[] = [];
  for (const entry of raw) {
    const withId =
      entry && typeof entry === "object" && !Array.isArray(entry) && !("id" in entry)
        ? { ...(entry as Record<string, unknown>), id: generateItemId() }
        : entry;
    const parsed = schema.safeParse(withId);
    if (!parsed.success) {
      return { ok: false, items: [], error: parsed.error.issues[0]?.message ?? "Invalid item" };
    }
    items.push(parsed.data as SectionItem);
  }
  return { ok: true, items, error: null };
}

/** Convenience default-title lookup that falls back to a Title Case of the
 *  raw kind string for a (theoretically impossible, but DB-untyped) unknown
 *  kind, so the UI never renders an empty header. */
export function defaultTitleFor(kind: string): string {
  if (isOverviewSectionKind(kind)) return DEFAULT_SECTION_TITLES[kind];
  return kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Kinds that belong to the Minutes of Meeting page only and are hidden
 *  from the Overview tab (and its "Add section" menu). */
export const MINUTES_ONLY_KINDS: readonly OverviewSectionKind[] = ["attendance", "minutes_table"];

export function isOverviewVisibleKind(kind: string): boolean {
  return !(MINUTES_ONLY_KINDS as readonly string[]).includes(kind);
}
