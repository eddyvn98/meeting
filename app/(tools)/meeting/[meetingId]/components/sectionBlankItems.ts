import type { OverviewSectionKind, SectionItem } from "@/lib/meeting/overviewSections";

/** A freshly added item's default content — always non-empty so it already
 *  satisfies the kind's schema (`min(1)` on the required field) and can be
 *  saved immediately; the user then edits it in place. */
export function blankItemFor(kind: OverviewSectionKind): SectionItem {
  const id = `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  switch (kind) {
    case "actions":
      return { id, task: "New action item", owner: null, deadline: null, done: false, evidenceSegmentIds: [] };
    case "qa":
      return { id, question: "New question", answer: "", evidenceSegmentIds: [] };
    case "options_compare":
      return { id, option: "New option", pros: [], cons: [], evidenceSegmentIds: [] };
    case "metrics":
      return { id, label: "New metric", value: "0", evidenceSegmentIds: [] };
    case "attendance":
      return { id, name: "New attendee", role: null, organization: null, status: null };
    case "minutes_table":
      return { id, title: "New matter", rows: [] };
    default:
      return { id, text: "New item", evidenceSegmentIds: [] };
  }
}
