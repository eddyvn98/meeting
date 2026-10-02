/**
 * lib/meeting/buildDownloadText.ts
 *
 * Plain-text builders for the Meeting Result screen's Download menu
 * (MeetingDownloadMenu.tsx). Kept framework-agnostic (no React) so it's
 * trivially unit-testable and reusable if a second download entry point
 * ever needs the same text.
 */

import { formatClock } from "@/lib/meeting/format";
import type { MeetingSummary, OverviewSection, TranscriptSegment } from "@/lib/meeting/types";
import { parseSectionItems, type AttendanceSectionItem, type MinutesMatter, type OverviewSectionKind, type SectionItem } from "@/lib/meeting/overviewSections";

/** Subset of MeetingAskAnswerCard.tsx's `AskAnswer` this module needs —
 *  kept local so this framework-agnostic lib module doesn't import from
 *  app/ (a component file). */
interface AskAnswerLike {
  question: string;
  answer: string;
  pending?: boolean;
}

export function buildRawTranscriptText(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => s.textEn ?? s.textVi ?? "")
    .filter(Boolean)
    .join(" ");
}

export function buildSpeakerScriptText(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => `[${formatClock(s.startTimeMs)}] ${s.speakerDisplayName}: ${s.textEn ?? s.textVi ?? ""}`)
    .join("\n\n");
}

/** Speaker-grouped script for the Transcript tab's "Copy all": one block per
 *  turn ("Name [mm:ss]" then the text), in the language(s) currently shown.
 *  Bilingual adds the translated line under the original one. */
export function buildSpeakerCopyText(
  segments: TranscriptSegment[],
  mode: "en" | "vi" | "bilingual",
  nameFor: (segment: TranscriptSegment) => string = (s) => s.speakerDisplayName,
): string {
  return segments
    .map((s) => {
      const lines = mode === "vi" ? [s.textVi ?? s.textEn] : mode === "bilingual" ? [s.textEn, s.textVi] : [s.textEn ?? s.textVi];
      const body = lines.filter((line): line is string => Boolean(line && line.trim())).join("\n");
      return body ? `${nameFor(s)} [${formatClock(s.startTimeMs)}]\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Renders one section item as a single line, per its kind's shape — kept
 *  close to how the Overview tab's cards present each kind (see
 *  MeetingGenericSectionCards.tsx / MeetingActionItemsCard.tsx etc). */
function formatSectionItem(kind: OverviewSectionKind, item: SectionItem): string {
  if ("task" in item) return `${item.task}${item.owner ? ` (${item.owner})` : ""}${item.deadline ? ` — due ${item.deadline}` : ""}${item.done ? " [done]" : ""}`;
  if ("question" in item) return `Q: ${item.question}${item.answer ? `\n  A: ${item.answer}` : ""}`;
  if ("option" in item) {
    const pros = item.pros.length > 0 ? ` | Pros: ${item.pros.join(", ")}` : "";
    const cons = item.cons.length > 0 ? ` | Cons: ${item.cons.join(", ")}` : "";
    return `${item.option}${pros}${cons}`;
  }
  if ("label" in item && "value" in item) return `${item.label}: ${item.value}`;
  if ("name" in item) return formatAttendanceItem(item);
  if ("rows" in item) return formatMinutesMatter(item);
  return item.text;
}

/** `attendance`: "Name (Role) — present" / "— regrets" / "" (unset). */
function formatAttendanceItem(item: AttendanceSectionItem): string {
  const role = item.role ? ` (${item.role})` : "";
  const status = item.status === "present" ? " — present" : item.status === "regrets" ? " — regrets" : "";
  return `${item.name}${role}${status}`;
}

/** `minutes_table`: one matter as a heading line, then each row's
 *  discussion bullets, actions (with duration/deadline/ongoing), and
 *  responsible names, indented under it — mirrors the MOM layout's
 *  numbered-matter/row structure in plain text. */
function formatMinutesMatter(matter: MinutesMatter): string {
  const lines = [matter.title];
  for (const row of matter.rows) {
    for (const line of row.discussion) lines.push(`  - ${line}`);
    for (const action of row.actions) {
      const when = action.ongoing ? "Ongoing" : [action.duration, action.deadline].filter(Boolean).join(", ");
      lines.push(`    Action: ${action.text}${when ? ` (${when})` : ""}`);
    }
    if (row.responsible.length > 0) lines.push(`    Responsible: ${row.responsible.join(", ")}`);
  }
  return lines.join("\n");
}

function buildSectionText(section: OverviewSection): string {
  const items = parseSectionItems(section.kind as OverviewSectionKind, section.items);
  if (items.length === 0) return "";
  return [`${section.title}:`, ...items.map((item) => `- ${formatSectionItem(section.kind as OverviewSectionKind, item)}`), ""].join("\n");
}

function buildSummaryText(summary: MeetingSummary | null): string {
  if (!summary) return "(No summary generated yet.)";
  const sections = [...summary.sections].sort((a, b) => a.order - b.order);
  const lines = [summary.overview, "", ...sections.map(buildSectionText).filter(Boolean)];
  return lines.join("\n").trim();
}

function buildAskConversationText(answers: AskAnswerLike[]): string {
  if (answers.length === 0) return "(No questions asked in this session.)";
  return answers
    .filter((a) => !a.pending)
    .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
    .join("\n\n");
}

/** The "full package" download: transcript by speaker + AI summary + this
 *  session's Ask AI conversation, one file with clearly labeled sections. */
export function buildFullPackageText(options: {
  title: string;
  segments: TranscriptSegment[];
  summary: MeetingSummary | null;
  askAnswers: AskAnswerLike[];
}): string {
  return [
    `Meeting: ${options.title}`,
    "",
    "=== Transcript (by speaker) ===",
    buildSpeakerScriptText(options.segments) || "(No transcript yet.)",
    "",
    "=== Summary ===",
    buildSummaryText(options.summary),
    "",
    "=== Ask AI Conversation ===",
    buildAskConversationText(options.askAnswers),
  ].join("\n");
}
