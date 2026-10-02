/**
 * lib/meeting/ai/buildSummaryCreateInput.ts
 *
 * Turns a ParsedMeetingInsights (agent output, evidence as array indexes)
 * plus the real, already-persisted TranscriptSegment ids for those indexes
 * into the nested-create input for `prisma.meetingSummary.create`. Split out
 * from transcript/route.ts so this index-to-id mapping (easy to get subtly
 * wrong) is unit-testable without a database.
 */

import type { Prisma } from "@prisma/client";
import type { ParsedMeetingInsights, ParsedMinutesMatter } from "./meetingInsightsParser";
import { normalizeGeneratedItems } from "../sectionGeneration";
import { DEFAULT_SECTION_TITLES, type ActionSectionItem, type MinutesMatter, type TextSectionItem } from "../overviewSections";

function evidenceIds(index: number | null, segmentIds: string[]): string[] {
  if (index === null) return [];
  const id = segmentIds[index];
  return id ? [id] : [];
}

/** Per-item id for freshly generated section items (these live in a JSON
 *  array, not their own Prisma rows, so they don't get a cuid from the DB).
 *  `index` makes it unique within a single build call; not used for
 *  anything security-sensitive — only React keys and future edit
 *  targeting. */
function sectionItemId(prefix: string, index: number): string {
  return `${prefix}_${Date.now().toString(36)}_${index}`;
}

/** Builds the `minutes_table` section's `items` (MinutesMatter[]) from the
 *  agent's parsed `minutes` matters, assigning ids to every nested level
 *  (matter/row/action — none of these are their own Prisma rows, same
 *  reasoning as sectionItemId above). Exported so
 *  POST .../minutes/generate (regenerate-only) can reuse the exact same
 *  transform without duplicating it. */
export function buildMinutesTableItems(matters: ParsedMinutesMatter[], segmentIds: string[]): MinutesMatter[] {
  return matters.map((matter, matterIndex) => ({
    id: sectionItemId("matter", matterIndex),
    title: matter.title,
    rows: matter.rows.map((row, rowIndex) => ({
      id: `${sectionItemId("row", matterIndex)}_${rowIndex}`,
      discussion: row.discussion,
      actions: row.actions.map((action, actionIndex) => ({
        id: `${sectionItemId("action", matterIndex)}_${rowIndex}_${actionIndex}`,
        text: action.text,
        duration: action.duration,
        deadline: action.deadline,
        ongoing: action.ongoing,
      })),
      responsible: row.responsible,
      evidenceSegmentIds: evidenceIds(row.evidenceIndex, segmentIds),
    })),
  }));
}

/** `segmentIds` must be ordered to match the segment array indexes the
 *  agent was given (i.e. the same order passed into generateMeetingInsights),
 *  otherwise evidence links point at the wrong utterance. */
export function buildSummaryCreateInput(
  meetingId: string,
  overview: string,
  insights: ParsedMeetingInsights | null,
  segmentIds: string[],
): Prisma.MeetingSummaryCreateInput {
  const decisions = insights?.decisions ?? [];
  const actionItems = insights?.actionItems ?? [];
  const blockers = insights?.blockers ?? [];

  const actionSectionItems: ActionSectionItem[] = actionItems.map((item, index) => ({
    id: sectionItemId("action", index),
    task: item.task,
    owner: item.owner,
    deadline: item.deadline,
    done: false,
    evidenceSegmentIds: evidenceIds(item.evidenceIndex, segmentIds),
  }));
  const decisionSectionItems: TextSectionItem[] = decisions.map((item, index) => ({
    id: sectionItemId("decision", index),
    text: item.text,
    evidenceSegmentIds: evidenceIds(item.evidenceIndex, segmentIds),
  }));
  const blockerSectionItems: TextSectionItem[] = blockers.map((item, index) => ({
    id: sectionItemId("blocker", index),
    text: item.text,
    evidenceSegmentIds: evidenceIds(item.evidenceIndex, segmentIds),
  }));
  const minutesTableItems: MinutesMatter[] = buildMinutesTableItems(insights?.minutes ?? [], segmentIds);

  const chosen = insights?.sections ?? [];
  const overviewSections: Array<{ kind: string; title: string; items: Prisma.InputJsonValue }> =
    chosen.length > 0
      ? chosen.flatMap((section, index) => {
          const items = normalizeGeneratedItems(section.kind, section.items, segmentIds, `${section.kind}_${Date.now().toString(36)}_${index}`);
          return items.length > 0
            ? [{ kind: section.kind, title: section.title || DEFAULT_SECTION_TITLES[section.kind], items: items as unknown as Prisma.InputJsonValue }]
            : [];
        })
      : ([
          { kind: "actions", title: DEFAULT_SECTION_TITLES.actions, items: actionSectionItems },
          { kind: "decisions", title: DEFAULT_SECTION_TITLES.decisions, items: decisionSectionItems },
          { kind: "blockers", title: DEFAULT_SECTION_TITLES.blockers, items: blockerSectionItems },
        ] as Array<{ kind: string; title: string; items: Prisma.InputJsonValue }>).filter((section) => (section.items as unknown[]).length > 0);

  return {
    meeting: { connect: { id: meetingId } },
    overview,
    topics: {
      create: (insights?.topics ?? []).map((topic, order) => ({
        title: topic.title,
        evidenceSegmentIds: evidenceIds(topic.evidenceIndex, segmentIds),
        order,
      })),
    },
    decisions: {
      create: (insights?.decisions ?? []).map((decision) => ({
        text: decision.text,
        evidenceSegmentIds: evidenceIds(decision.evidenceIndex, segmentIds),
      })),
    },
    actionItems: {
      create: (insights?.actionItems ?? []).map((item) => ({
        task: item.task,
        owner: item.owner,
        deadline: item.deadline,
        evidenceSegmentIds: evidenceIds(item.evidenceIndex, segmentIds),
      })),
    },
    blockers: {
      create: blockers.map((blocker) => ({
        text: blocker.text,
        evidenceSegmentIds: evidenceIds(blocker.evidenceIndex, segmentIds),
      })),
    },
    // Overview sections. When the AI chose sections for this meeting, exactly
    // those are created — nothing is forced. A reply in the old fixed shape
    // (no `sections`) falls back to whichever of actions / decisions /
    // blockers actually have items. `minutes_table` comes last and is only
    // created when the agent produced a matters table.
    sections: {
      create: [
        ...overviewSections.map((section, order) => ({ ...section, order, source: "ai" })),
        ...(minutesTableItems.length > 0
          ? [
              {
                kind: "minutes_table",
                title: DEFAULT_SECTION_TITLES.minutes_table,
                order: overviewSections.length,
                source: "ai",
                items: minutesTableItems,
              },
            ]
          : []),
      ],
    },
  };
}
