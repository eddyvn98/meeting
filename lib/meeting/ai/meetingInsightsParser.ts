/**
 * lib/meeting/ai/meetingInsightsParser.ts
 *
 * Pure parsing/validation for the JSON insights payload the meeting agent
 * (difyMeetingAgent.ts generateMeetingInsights) is asked to return. Kept
 * separate from the network call so it can be unit-tested with plain
 * strings — no Dify/fetch mocking required. `evidenceIndex` values refer to
 * the 0-based position in the transcript segment array the caller sent the
 * agent, NOT a database id (the agent never sees real ids) — the caller
 * (transcript/route.ts, via buildSummaryCreateInput.ts) resolves indexes to
 * real TranscriptSegment ids after segments are persisted.
 */

import type { OverviewSectionKind } from "../overviewSections";
import { isGeneratableKind, itemKey } from "../sectionGeneration";

export interface ParsedInsightItem {
  text: string;
  evidenceIndex: number | null;
}

export interface ParsedActionItem {
  task: string;
  owner: string | null;
  deadline: string | null;
  evidenceIndex: number | null;
}

export interface ParsedTopic {
  title: string;
  evidenceIndex: number | null;
}

/** One action under a `minutes` matter row — mirrors MinutesActionItem in
 *  overviewSections.ts, minus `id` (assigned by buildSummaryCreateInput.ts
 *  once persisted, same as every other insight item). */
export interface ParsedMinutesAction {
  text: string;
  duration: string | null;
  deadline: string | null;
  ongoing: boolean;
}

/** One row under a `minutes` matter. */
export interface ParsedMinutesRow {
  discussion: string[];
  actions: ParsedMinutesAction[];
  responsible: string[];
  evidenceIndex: number | null;
}

/** One numbered MOM matter — the agent's proposal for a `minutes_table`
 *  section item (see lib/meeting/overviewSections.ts's MinutesMatter). */
export interface ParsedMinutesMatter {
  title: string;
  rows: ParsedMinutesRow[];
}

/** One overview section the AI chose for this meeting. `items` are the raw item
 *  objects (shape depends on `kind` — see sectionGeneration.ts), each with its
 *  `evidenceIndex` clamped to a valid index or null; they are validated and
 *  given ids by normalizeGeneratedItems once real segment ids are known. */
export interface ParsedSection {
  kind: OverviewSectionKind;
  title: string | null;
  items: Array<Record<string, unknown>>;
}

export interface ParsedMeetingInsights {
  overview: string;
  topics: ParsedTopic[];
  /** Sections the AI chose for this meeting (any of the overview kinds) — the
   *  Overview tab is built from these. Empty when the agent returned none. */
  sections: ParsedSection[];
  /** Kept for the legacy child tables: parsed from the old fixed-shape reply,
   *  or derived from the `decisions` / `actions` / `blockers` sections. */
  decisions: ParsedInsightItem[];
  actionItems: ParsedActionItem[];
  blockers: ParsedInsightItem[];
  /** MOM matters table — see buildInsightsQuery's prompt instructions.
   *  Empty when the agent found nothing MOM-worthy, same convention as the
   *  other array fields (never omitted, never null). */
  minutes: ParsedMinutesMatter[];
  /** A short content-derived title, or null when the agent judged the
   *  transcript too short/unclear to title confidently — see
   *  buildInsightsQuery's prompt instructions. transcript/route.ts only
   *  applies this over a meeting's still-default "Meeting - <timestamp>"
   *  title, never over one the user already set. */
  suggestedTitle: string | null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clampIndex(value: unknown, segmentCount: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const idx = Math.trunc(value);
  return idx >= 0 && idx < segmentCount ? idx : null;
}

const MAX_TITLE_CHARS = 80;
const MIN_TITLE_CHARS = 3;

/** A short, plausible title, or null. Guards against the agent ignoring the
 *  "null if unclear" instruction and returning junk instead (a single
 *  character, or a whole paragraph) — those are treated the same as an
 *  explicit null rather than persisted as a meeting title. */
function asTitle(value: unknown): string | null {
  const text = asText(value);
  if (!text || text.length < MIN_TITLE_CHARS || text.length > MAX_TITLE_CHARS) return null;
  return text;
}

/** A valid ISO date deadline, or null. Rejects anything else (including
 *  vague text like "next week") rather than passing it to Prisma's
 *  `DateTime?` field, which would throw. */
function asIsoDate(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const MAX_SECTIONS = 10;
const MAX_ITEMS_PER_SECTION = 15;

function parseSections(value: unknown, segmentCount: number): ParsedSection[] {
  if (!Array.isArray(value)) return [];
  const sections: ParsedSection[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const kind = asText(rec.kind);
    if (!kind || !isGeneratableKind(kind) || !Array.isArray(rec.items)) continue;
    const title = asText(rec.title);
    const items = rec.items
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .slice(0, MAX_ITEMS_PER_SECTION)
      .map((item) => ({ ...item, evidenceIndex: clampIndex(item.evidenceIndex, segmentCount) }));
    if (items.length === 0) continue;
    sections.push({ kind, title: title ? title.slice(0, 60) : null, items });
    if (sections.length >= MAX_SECTIONS) break;
  }
  return sections;
}

/** Combines the sections chosen for each chunk of a long transcript: same kind
 *  merges into one section (first title wins), items are de-duplicated, and
 *  each chunk's evidence indexes are shifted by that chunk's offset into the
 *  whole transcript. */
export function mergeParsedSections(perChunk: Array<{ sections: ParsedSection[]; offset: number }>): ParsedSection[] {
  const byKind = new Map<OverviewSectionKind, { title: string | null; items: Array<Record<string, unknown>>; seen: Set<string> }>();
  for (const { sections, offset } of perChunk) {
    for (const section of sections) {
      const target = byKind.get(section.kind) ?? { title: section.title, items: [], seen: new Set<string>() };
      if (!target.title) target.title = section.title;
      for (const item of section.items) {
        const key = itemKey(item);
        if (!key || target.seen.has(key) || target.items.length >= MAX_ITEMS_PER_SECTION) continue;
        target.seen.add(key);
        target.items.push({ ...item, evidenceIndex: typeof item.evidenceIndex === "number" ? item.evidenceIndex + offset : null });
      }
      byKind.set(section.kind, target);
    }
  }
  return [...byKind.entries()].slice(0, MAX_SECTIONS).map(([kind, v]) => ({ kind, title: v.title, items: v.items }));
}

function sectionItems(sections: ParsedSection[], kind: OverviewSectionKind): Array<Record<string, unknown>> {
  return sections.filter((s) => s.kind === kind).flatMap((s) => s.items);
}

function deriveInsightItems(sections: ParsedSection[], kind: OverviewSectionKind): ParsedInsightItem[] {
  return sectionItems(sections, kind).flatMap((item) => {
    const text = asText(item.text);
    return text ? [{ text, evidenceIndex: typeof item.evidenceIndex === "number" ? item.evidenceIndex : null }] : [];
  });
}

function deriveActionItems(sections: ParsedSection[]): ParsedActionItem[] {
  return sectionItems(sections, "actions").flatMap((item) => {
    const task = asText(item.task);
    if (!task) return [];
    return [{ task, owner: asText(item.owner), deadline: asIsoDate(item.deadline), evidenceIndex: typeof item.evidenceIndex === "number" ? item.evidenceIndex : null }];
  });
}

function parseTopics(value: unknown, segmentCount: number): ParsedTopic[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): ParsedTopic | null => {
      const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const title = asText(row.title);
      if (!title) return null;
      return { title, evidenceIndex: clampIndex(row.evidenceIndex, segmentCount) };
    })
    .filter((t): t is ParsedTopic => t !== null);
}

function parseInsightItems(value: unknown, segmentCount: number): ParsedInsightItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): ParsedInsightItem | null => {
      const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const text = asText(row.text);
      if (!text) return null;
      return { text, evidenceIndex: clampIndex(row.evidenceIndex, segmentCount) };
    })
    .filter((t): t is ParsedInsightItem => t !== null);
}

function parseActionItems(value: unknown, segmentCount: number): ParsedActionItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): ParsedActionItem | null => {
      const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const task = asText(row.task);
      if (!task) return null;
      return {
        task,
        owner: asText(row.owner),
        deadline: asIsoDate(row.deadline),
        evidenceIndex: clampIndex(row.evidenceIndex, segmentCount),
      };
    })
    .filter((t): t is ParsedActionItem => t !== null);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function parseMinutesActions(value: unknown): ParsedMinutesAction[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): ParsedMinutesAction | null => {
      const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const text = asText(row.text);
      if (!text) return null;
      return { text, duration: asText(row.duration), deadline: asText(row.deadline), ongoing: asBoolean(row.ongoing) };
    })
    .filter((a): a is ParsedMinutesAction => a !== null);
}

function parseMinutesRows(value: unknown, segmentCount: number): ParsedMinutesRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): ParsedMinutesRow | null => {
      const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const discussion = asStringArray(row.discussion);
      const actions = parseMinutesActions(row.actions);
      const responsible = asStringArray(row.responsible);
      // Drop a row with nothing useful in it at all rather than persisting
      // an empty shell.
      if (discussion.length === 0 && actions.length === 0 && responsible.length === 0) return null;
      return { discussion, actions, responsible, evidenceIndex: clampIndex(row.evidenceIndex, segmentCount) };
    })
    .filter((r): r is ParsedMinutesRow => r !== null);
}

/** Defensive by design: the agent's `minutes` field is the deepest-nested
 *  part of the response shape (matter -> row -> action), so it's the most
 *  likely to come back malformed — every level here drops the offending
 *  entry/row/action instead of failing the whole insights parse. */
function parseMinutesMatters(value: unknown, segmentCount: number): ParsedMinutesMatter[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): ParsedMinutesMatter | null => {
      const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const title = asText(row.title);
      if (!title) return null;
      return { title, rows: parseMinutesRows(row.rows, segmentCount) };
    })
    .filter((m): m is ParsedMinutesMatter => m !== null);
}

/** Pulls the first `{...}` JSON object out of raw agent text, unwrapping a
 *  ```json fenced block first if present (chat agents commonly wrap JSON in
 *  one even when told not to). Returns null if no plausible object is found —
 *  callers must treat that as "no structured insights", not an error. */
function extractJsonBlock(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

/**
 * Parses+validates the agent's raw response text into structured insights.
 * Returns null when the text has no usable JSON object, the JSON is
 * malformed, or every field ends up empty — callers fall back to a naive
 * placeholder summary in that case rather than persisting an empty result.
 */
export function parseMeetingInsights(raw: string, segmentCount: number): ParsedMeetingInsights | null {
  const jsonText = extractJsonBlock(raw);
  if (!jsonText) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;

  const overview = asText(root.overview) ?? "";
  const topics = parseTopics(root.topics, segmentCount);
  const sections = parseSections(root.sections, segmentCount);
  // Old fixed-shape replies (no `sections`) still parse; otherwise the legacy
  // arrays are derived from the sections the AI chose.
  const decisions = root.decisions !== undefined ? parseInsightItems(root.decisions, segmentCount) : deriveInsightItems(sections, "decisions");
  const actionItems = root.actionItems !== undefined ? parseActionItems(root.actionItems, segmentCount) : deriveActionItems(sections);
  const blockers = root.blockers !== undefined ? parseInsightItems(root.blockers, segmentCount) : deriveInsightItems(sections, "blockers");
  const minutes = parseMinutesMatters(root.minutes, segmentCount);
  const suggestedTitle = asTitle(root.suggestedTitle);

  if (
    !overview &&
    topics.length === 0 &&
    sections.length === 0 &&
    decisions.length === 0 &&
    actionItems.length === 0 &&
    blockers.length === 0 &&
    minutes.length === 0
  ) {
    return null;
  }
  return { overview, topics, sections, decisions, actionItems, blockers, minutes, suggestedTitle };
}
