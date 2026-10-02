/**
 * lib/meeting/serialize.ts
 *
 * Converts Prisma row shapes (Date instances, DB enums) into the plain JSON
 * shapes in lib/meeting/types.ts that API routes return and the UI imports.
 * Kept out of the route files so a route body stays a thin
 * fetch-then-respond, matching the rest of this repo's API routes.
 */

import type {
  Meeting as PrismaMeeting,
  MeetingGroup as PrismaMeetingGroup,
  AudioChunk as PrismaAudioChunk,
  Speaker as PrismaSpeaker,
  SpeakerMapping as PrismaSpeakerMapping,
  TranscriptSegment as PrismaTranscriptSegment,
  Bookmark as PrismaBookmark,
  MeetingSummary as PrismaMeetingSummary,
  Topic as PrismaTopic,
  Decision as PrismaDecision,
  ActionItem as PrismaActionItem,
  Blocker as PrismaBlocker,
  OpenQuestion as PrismaOpenQuestion,
  MeetingOverviewSection as PrismaOverviewSection,
} from "@prisma/client";
import type {
  Meeting,
  MeetingGroup,
  AudioChunk,
  Speaker,
  SpeakerMapping,
  TranscriptSegment,
  Bookmark,
  MeetingSummary,
  Topic,
  Decision,
  ActionItem,
  Blocker,
  OpenQuestion,
  OverviewSection,
} from "./types";
import { DEFAULT_SECTION_TITLES } from "./overviewSections";

export function serializeMeeting(row: PrismaMeeting): Meeting {
  return {
    id: row.id,
    ownerEmail: row.ownerEmail,
    title: row.title,
    status: row.status,
    audioUrl: row.audioUrl,
    durationSec: row.durationSec,
    fileSizeBytes: row.fileSizeBytes,
    mimeType: row.mimeType,
    sttLanguage: row.sttLanguage,
    failureReason: row.failureReason,
    isMockResult: row.isMockResult,
    mindmapBoardId: row.mindmapBoardId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    groupId: row.groupId,
  };
}

export function serializeMeetingGroup(row: PrismaMeetingGroup): MeetingGroup {
  return {
    id: row.id,
    ownerEmail: row.ownerEmail,
    name: row.name,
    order: row.order,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeAudioChunk(row: PrismaAudioChunk): AudioChunk {
  return {
    id: row.id,
    meetingId: row.meetingId,
    sequence: row.sequence,
    storageUrl: row.storageUrl,
    durationSec: row.durationSec,
    sizeBytes: row.sizeBytes,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeSpeaker(row: PrismaSpeaker): Speaker {
  return {
    id: row.id,
    meetingId: row.meetingId,
    speakerKey: row.speakerKey,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeSpeakerMapping(row: PrismaSpeakerMapping): SpeakerMapping {
  return {
    id: row.id,
    meetingId: row.meetingId,
    speakerKey: row.speakerKey,
    displayName: row.displayName,
    updatedByEmail: row.updatedByEmail,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Resolves speakerDisplayName from the mapping list (falls back to the raw
 *  key) so the UI never has to do this join itself. */
export function serializeTranscriptSegment(
  row: PrismaTranscriptSegment,
  mappingsByKey: Map<string, string>,
): TranscriptSegment {
  return {
    id: row.id,
    meetingId: row.meetingId,
    speakerKey: row.speakerKey,
    speakerDisplayName: mappingsByKey.get(row.speakerKey) ?? row.speakerKey,
    order: row.order,
    startTimeMs: row.startTimeMs,
    endTimeMs: row.endTimeMs,
    textEn: row.textEn,
    textVi: row.textVi,
  };
}

export function serializeBookmark(row: PrismaBookmark): Bookmark {
  return {
    id: row.id,
    meetingId: row.meetingId,
    timestampMs: row.timestampMs,
    label: row.label,
    createdByEmail: row.createdByEmail,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeTopic(row: PrismaTopic): Topic {
  return { id: row.id, title: row.title, evidenceSegmentIds: row.evidenceSegmentIds, order: row.order };
}

export function serializeDecision(row: PrismaDecision): Decision {
  return { id: row.id, text: row.text, evidenceSegmentIds: row.evidenceSegmentIds, timestampMs: row.timestampMs };
}

export function serializeActionItem(row: PrismaActionItem): ActionItem {
  return {
    id: row.id,
    task: row.task,
    owner: row.owner,
    deadline: row.deadline ? row.deadline.toISOString() : null,
    status: row.status,
    evidenceSegmentIds: row.evidenceSegmentIds,
    startTimeMs: row.startTimeMs,
    endTimeMs: row.endTimeMs,
  };
}

export function serializeBlocker(row: PrismaBlocker): Blocker {
  return { id: row.id, text: row.text, evidenceSegmentIds: row.evidenceSegmentIds, timestampMs: row.timestampMs };
}

export function serializeOpenQuestion(row: PrismaOpenQuestion): OpenQuestion {
  return { id: row.id, text: row.text, evidenceSegmentIds: row.evidenceSegmentIds, timestampMs: row.timestampMs };
}

export function serializeOverviewSection(row: PrismaOverviewSection): OverviewSection {
  const items = Array.isArray(row.items) ? row.items : [];
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    order: row.order,
    source: row.source === "user" ? "user" : "ai",
    items,
  };
}

/** Builds the three legacy-equivalent sections (actions/decisions/blockers,
 *  always present; open_questions only when non-empty) from a summary's old
 *  child tables. Used as a fallback in `serializeMeetingSummary` for any
 *  summary row that somehow has no MeetingOverviewSection rows yet (e.g. a
 *  row created between the schema migration landing and its backfill, or in
 *  a test that builds a summary without sections) — the Overview tab always
 *  has something to render instead of an empty section list. */
export function synthesizeLegacySections(row: SummaryWithChildren): OverviewSection[] {
  const all: OverviewSection[] = [
    {
      id: `legacy-actions-${row.id}`,
      kind: "actions",
      title: DEFAULT_SECTION_TITLES.actions,
      order: 0,
      source: "ai",
      items: row.actionItems.map((item) => ({
        id: item.id,
        task: item.task,
        owner: item.owner,
        deadline: item.deadline ? item.deadline.toISOString() : null,
        done: item.status === "DONE",
        evidenceSegmentIds: item.evidenceSegmentIds,
      })),
    },
    {
      id: `legacy-decisions-${row.id}`,
      kind: "decisions",
      title: DEFAULT_SECTION_TITLES.decisions,
      order: 1,
      source: "ai",
      items: row.decisions.map((item) => ({
        id: item.id,
        text: item.text,
        evidenceSegmentIds: item.evidenceSegmentIds,
      })),
    },
    {
      id: `legacy-blockers-${row.id}`,
      kind: "blockers",
      title: DEFAULT_SECTION_TITLES.blockers,
      order: 2,
      source: "ai",
      items: row.blockers.map((item) => ({
        id: item.id,
        text: item.text,
        evidenceSegmentIds: item.evidenceSegmentIds,
      })),
    },
  ];
  // Only cards that have content: AI-chosen (or user-emptied) sections must
  // never bring back three empty default cards.
  const sections = all.filter((section) => section.items.length > 0);
  if (row.openQuestions.length > 0) {
    sections.push({
      id: `legacy-open-questions-${row.id}`,
      kind: "open_questions",
      title: DEFAULT_SECTION_TITLES.open_questions,
      order: 3,
      source: "ai",
      items: row.openQuestions.map((item) => ({
        id: item.id,
        text: item.text,
        evidenceSegmentIds: item.evidenceSegmentIds,
      })),
    });
  }
  return sections;
}

type SummaryWithChildren = PrismaMeetingSummary & {
  topics: PrismaTopic[];
  decisions: PrismaDecision[];
  actionItems: PrismaActionItem[];
  blockers: PrismaBlocker[];
  openQuestions: PrismaOpenQuestion[];
  sections?: PrismaOverviewSection[];
};

export function serializeMeetingSummary(row: SummaryWithChildren): MeetingSummary {
  const sections =
    row.sections && row.sections.length > 0
      ? [...row.sections].sort((a, b) => a.order - b.order).map(serializeOverviewSection)
      : synthesizeLegacySections(row);

  return {
    id: row.id,
    meetingId: row.meetingId,
    overview: row.overview,
    meetingLabel: row.meetingLabel ?? null,
    topics: row.topics.map(serializeTopic),
    decisions: row.decisions.map(serializeDecision),
    actionItems: row.actionItems.map(serializeActionItem),
    blockers: row.blockers.map(serializeBlocker),
    openQuestions: row.openQuestions.map(serializeOpenQuestion),
    sections,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
