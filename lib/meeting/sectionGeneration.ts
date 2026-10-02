/**
 * lib/meeting/sectionGeneration.ts
 *
 * Pure (no network) half of "Generate with AI" for one Overview section: the
 * per-kind prompt, parsing the agent's JSON into validated section items, and
 * merging them into what the section already holds. The merge only ever
 * ADDS — it never edits or removes an existing item, so AI content and the
 * user's own content live side by side.
 */

import {
  parseSectionItems,
  type OverviewSectionKind,
  type SectionItem,
} from "./overviewSections";

/** Kinds this can generate: every Overview-visible kind. `attendance` and
 *  `minutes_table` are Minutes-page-only (minutes has its own generator). */
type ItemShape = { shape: string; guide: string };

const TEXT_SHAPE = '{"text": "one short, self-contained line", "evidenceIndex": 0}';

const SPECS: Partial<Record<OverviewSectionKind, ItemShape>> = {
  key_points: { shape: TEXT_SHAPE, guide: "the most important points made in the meeting" },
  decisions: { shape: TEXT_SHAPE, guide: "decisions that were actually made or agreed (not merely discussed)" },
  blockers: { shape: TEXT_SHAPE, guide: "obstacles or blockers that are holding work back" },
  risks: { shape: TEXT_SHAPE, guide: "risks or concerns raised about what could go wrong" },
  open_questions: { shape: TEXT_SHAPE, guide: "questions that were raised but left unanswered" },
  feedback: { shape: TEXT_SHAPE, guide: "feedback, opinions or reactions people gave" },
  quotes: { shape: TEXT_SHAPE, guide: "short, notable verbatim quotes worth keeping (the exact words spoken)" },
  custom_text: { shape: TEXT_SHAPE, guide: "notable notes that do not fit another category" },
  actions: {
    shape: '{"task": "what needs doing", "owner": "person name or null", "deadline": "date or period as spoken, or null", "evidenceIndex": 0}',
    guide: "action items: concrete tasks someone committed to or was asked to do",
  },
  qa: {
    shape: '{"question": "a question that was asked", "answer": "the answer given, or empty string if unanswered", "evidenceIndex": 0}',
    guide: "questions that were asked together with their answers",
  },
  options_compare: {
    shape: '{"option": "an option that was considered", "pros": ["advantage"], "cons": ["drawback"], "evidenceIndex": 0}',
    guide: "options or alternatives that were compared, with their pros and cons",
  },
  metrics: {
    shape: '{"label": "what is measured", "value": "the figure as spoken, with its unit", "evidenceIndex": 0}',
    guide: "numbers, figures and metrics that were mentioned",
  },
};

export function isGeneratableKind(kind: string): kind is OverviewSectionKind {
  return kind in SPECS;
}

/** Text a user would recognise an item by — used to avoid adding a duplicate of
 *  something already in the section. */
export function itemKey(item: SectionItem | Record<string, unknown>): string {
  const rec = item as Record<string, unknown>;
  const raw = rec.text ?? rec.task ?? rec.question ?? rec.option ?? rec.label ?? "";
  return String(raw).toLowerCase().replace(/\s+/g, " ").trim();
}

/** One line per kind the AI may choose from, with the item shape it must use —
 *  embedded in the meeting-insights prompt so the AI can pick which sections
 *  suit this meeting's content. */
export function describeSectionKindsForPrompt(): string {
  return (Object.entries(SPECS) as [string, ItemShape][]).map(([kind, spec]) => `   - "${kind}": ${spec.guide}. Item: ${spec.shape}`).join("\n");
}

export function buildSectionQuery(options: {
  kind: OverviewSectionKind;
  sectionTitle: string;
  meetingTitle: string;
  numberedTranscript: string;
  existing: SectionItem[];
  isPartial: boolean;
  outputLanguage?: string;
}): string {
  const spec = SPECS[options.kind];
  if (!spec) throw new Error(`Cannot generate section kind: ${options.kind}`);
  const known = options.existing.map(itemKey).filter(Boolean);
  const partialNote = options.isPartial
    ? " This is one chunk of a longer transcript — only use what is shown, and assume nothing about parts you cannot see."
    : "";
  return [
    `From this meeting transcript (titled "${options.meetingTitle}"), extract items for the section "${options.sectionTitle}": ${spec.guide}.${partialNote} Each line is prefixed with its 0-based index in brackets, e.g. "[3]".`,
    `Reply with ONLY a single JSON object (no markdown fence, no prose) of exactly this shape:`,
    `{"items": [${spec.shape}]}`,
    `Use "evidenceIndex" to cite the transcript line that best supports each item. Return at most 8 items, grounded only in the transcript, and do not invent anything. Return {"items": []} if the transcript has nothing for this section.`,
    known.length > 0
      ? `The section already contains the items below — do NOT repeat them or restate them in other words; return only genuinely new items:\n${known.map((k) => `- ${k}`).join("\n")}`
      : "",
    options.outputLanguage
      ? `Write every text value in ${options.outputLanguage}, translating from the transcript where needed. Person names stay as spoken.`
      : `Write every text value in the same predominant language as the transcript. Person names stay as spoken.`,
    "",
    "Transcript:",
    options.numberedTranscript,
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
}

/** Finds the first balanced `{...}` or `[...]` JSON value in `text` that parses
 *  and satisfies `accept`. Ignores prose, <think> blocks and code fences around
 *  the JSON, so a chatty reply still yields its data. */
function findJson(text: string, accept: (value: unknown) => boolean): unknown {
  for (let start = 0; start < text.length; start++) {
    const open = text[start];
    if (open !== "{" && open !== "[") continue;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    for (let end = start; end < text.length; end++) {
      const ch = text[end];
      if (inString) {
        if (ch === "\\") end++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        try {
          const value = JSON.parse(text.slice(start, end + 1));
          if (accept(value)) return value;
        } catch {
          // Not valid JSON here; keep scanning from the next opening bracket.
        }
        break;
      }
    }
  }
  return null;
}

function extractItems(raw: string): unknown[] | null {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const found = findJson(cleaned, (value) => Array.isArray(value) || (Boolean(value) && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)));
  if (Array.isArray(found)) return found;
  return found ? (found as { items: unknown[] }).items : null;
}

/** Validates raw AI item objects for `kind`: assigns ids, maps each item's
 *  `evidenceIndex` to a real segment id (`segmentIds[i]`), and drops entries
 *  that fail the kind's schema. */
export function normalizeGeneratedItems(kind: OverviewSectionKind, rawItems: unknown[], segmentIds: string[], idPrefix: string): SectionItem[] {
  const withIds = rawItems
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    .map((entry, index) => {
      const evidenceIndex = Number.isFinite(Number(entry.evidenceIndex)) && entry.evidenceIndex !== null && entry.evidenceIndex !== "" ? Math.trunc(Number(entry.evidenceIndex)) : null;
      const segmentId = evidenceIndex !== null ? segmentIds[evidenceIndex] : undefined;
      const { evidenceIndex: _dropped, ...rest } = entry;
      void _dropped;
      return { ...rest, id: `${idPrefix}_${index}`, evidenceSegmentIds: segmentId ? [segmentId] : [] };
    });
  return parseSectionItems(kind, withIds);
}

/** Parses one agent reply (`{"items": [...]}`) into validated items for `kind`.
 *  `segmentIds[i]` is the real TranscriptSegment id for evidence index `i` of
 *  THIS reply. Returns [] for unusable output. */
export function parseGeneratedItems(kind: OverviewSectionKind, raw: string, segmentIds: string[], idPrefix: string): SectionItem[] {
  const items = extractItems(raw);
  return items ? normalizeGeneratedItems(kind, items, segmentIds, idPrefix) : [];
}

/** Existing items first, untouched, then any generated item whose text is not
 *  already present (in the section or earlier in the generated list). */
export function mergeGeneratedItems(existing: SectionItem[], generated: SectionItem[]): { items: SectionItem[]; added: number } {
  const seen = new Set(existing.map(itemKey));
  const additions: SectionItem[] = [];
  for (const item of generated) {
    const key = itemKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    additions.push(item);
  }
  return { items: [...existing, ...additions], added: additions.length };
}
