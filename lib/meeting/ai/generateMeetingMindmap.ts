/**
 * lib/meeting/ai/generateMeetingMindmap.ts
 *
 * Turns a meeting's AI summary (overview/topics/dynamic overview sections)
 * into a mindmap outline via the same CHAT_KEY-backed agent used
 * by generateMeetingInsights (see difyMeetingAgent.ts) — Meeting has no
 * AI backend of its own, so this reuses callChatAgent rather than adding a
 * second Dify wiring. The outline is a plain label tree; the caller (the
 * mindmap route) turns it into workspace blocks via
 * buildTreeTemplateBlocks (app/workspace/utils/templates/workspaceDiagramTemplates.ts).
 */

import { callChatAgent } from "./difyMeetingAgent";
import type { MeetingSummary, OverviewSection } from "../types";
import { parseSectionItems, type OverviewSectionKind, type SectionItem } from "../overviewSections";

export interface MindmapOutlineNode {
  label: string;
  children?: MindmapOutlineNode[];
}

const MAX_DEPTH = 3;
const MAX_CHILDREN = 8;
const MAX_LABEL_CHARS = 80;

/** Recursively sanitizes the agent's JSON into a bounded, well-formed tree —
 *  cut to MAX_DEPTH/MAX_CHILDREN so a runaway or adversarial response can't
 *  produce an unusably huge board, and every label coerced to a trimmed,
 *  length-capped string so a malformed entry becomes an empty leaf instead
 *  of throwing partway through the board. */
function sanitizeNode(raw: unknown, depth: number): MindmapOutlineNode | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const label = typeof obj.label === "string" ? obj.label.trim().slice(0, MAX_LABEL_CHARS) : "";
  if (!label) return null;

  if (depth >= MAX_DEPTH || !Array.isArray(obj.children)) return { label };
  const children = obj.children
    .slice(0, MAX_CHILDREN)
    .map((child) => sanitizeNode(child, depth + 1))
    .filter((c): c is MindmapOutlineNode => c !== null);
  return children.length > 0 ? { label, children } : { label };
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** One-line-per-item digest of a section's items, per kind — same shape as
 *  buildDownloadText.ts's formatSectionItem, kept local (a plain single-line
 *  label is all the mindmap query needs). */
function summarizeItem(item: SectionItem): string {
  if ("task" in item) return `${item.task}${item.owner ? ` (${item.owner})` : ""}`;
  if ("question" in item) return item.answer ? `${item.question} — ${item.answer}` : item.question;
  if ("option" in item) return item.option;
  if ("label" in item && "value" in item) return `${item.label}: ${item.value}`;
  if ("name" in item) return `${item.name}${item.role ? ` (${item.role})` : ""}`;
  if ("rows" in item) return item.title;
  return item.text;
}

function summarizeSection(section: OverviewSection): string | null {
  const items = parseSectionItems(section.kind as OverviewSectionKind, section.items);
  if (items.length === 0) return null;
  return `${section.title}: ${items.map(summarizeItem).join("; ")}`;
}

function buildQuery(meetingTitle: string, summary: MeetingSummary): string {
  const sections = [...summary.sections].sort((a, b) => a.order - b.order);
  const lines = [
    `Overview: ${summary.overview || "(none)"}`,
    summary.topics.length > 0 ? `Topics: ${summary.topics.map((t) => t.title).join("; ")}` : null,
    ...sections.map(summarizeSection),
  ].filter((l): l is string => l !== null);

  return [
    `Turn this meeting summary (titled "${meetingTitle}") into a mindmap outline.`,
    `Reply with ONLY a single JSON object (no markdown fence, no prose before or after) matching exactly this shape:`,
    `{"label": "short root label (usually the meeting topic)", "children": [{"label": "branch name", "children": [{"label": "sub-point"}]}]}`,
    `Group related points under short branch labels (e.g. "Decisions", "Action Items", "Blockers", or actual topic names — whichever reads more naturally for this meeting). Each label must be short (a few words), not a full sentence. At most ${MAX_CHILDREN} children per node, at most ${MAX_DEPTH} levels deep. Base it only on the summary below — do not invent content.`,
    ``,
    lines.join("\n"),
  ].join("\n");
}

/** Builds an outline straight from the summary's structured fields, no AI
 *  call involved — used when generateMeetingMindmap returns null (agent
 *  unavailable/unparseable) so "Create mindmap" still produces something
 *  useful instead of failing outright. */
export function buildFallbackMindmapOutline(meetingTitle: string, summary: MeetingSummary): MindmapOutlineNode {
  const branch = (title: string, items: string[]): MindmapOutlineNode | null =>
    items.length > 0 ? { label: title, children: items.slice(0, MAX_CHILDREN).map((label) => ({ label: label.slice(0, MAX_LABEL_CHARS) })) } : null;

  const sections = [...summary.sections].sort((a, b) => a.order - b.order);
  const children = [
    branch("Topics", summary.topics.map((t) => t.title)),
    ...sections.map((section) =>
      branch(section.title, parseSectionItems(section.kind as OverviewSectionKind, section.items).map(summarizeItem)),
    ),
  ].filter((c): c is MindmapOutlineNode => c !== null);

  return { label: meetingTitle, children };
}

/** Generates a mindmap outline from a meeting's summary. Returns null (never
 *  throws) when the summary is empty, the agent call fails, or the response
 *  can't be parsed into a well-formed tree — callers should fall back to
 *  building a plain outline directly from `summary`'s fields instead of
 *  failing the whole "Create mindmap" action. */
export async function generateMeetingMindmap(options: {
  meetingTitle: string;
  summary: MeetingSummary;
  callerEmail: string;
}): Promise<MindmapOutlineNode | null> {
  const { meetingTitle, summary, callerEmail } = options;
  const hasSectionContent = summary.sections.some((section) => parseSectionItems(section.kind as OverviewSectionKind, section.items).length > 0);
  if (!summary.overview && summary.topics.length === 0 && !hasSectionContent) {
    return null;
  }

  const raw = await callChatAgent(
    buildQuery(meetingTitle, summary),
    callerEmail,
    undefined,
    AbortSignal.timeout(35_000),
    "mindmap",
  );
  if (!raw) return null;

  const parsed = extractJson(raw);
  return sanitizeNode(parsed, 0);
}
