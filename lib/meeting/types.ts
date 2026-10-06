/**
 * lib/meeting/types.ts
 *
 * Shared TypeScript shapes for the Meeting module. UI components import
 * these — never the generated Prisma Client types directly — so the DB
 * schema (prisma/schema.prisma Meeting section) can evolve without
 * every screen agent re-typing its own mock shape. All dates are ISO 8601
 * strings (as returned by `NextResponse.json`, not `Date` instances) and all
 * durations/timestamps are plain milliseconds unless the field name says
 * otherwise (`*Sec` = seconds), matching the API route responses in
 * app/api/meeting/**.
 */

import type { MeetingShareRole } from "./shareTypes";
export type {
  AttendanceSuggestion,
  MeetingMinutes,
  UpdateMeetingMinutesInput,
} from "./meetingMinutesTypes";

/** Reserved displayName marking a diarized speaker as noise/not-a-real-person
 *  ("delete" in the Speakers panel — see MeetingSpeakerRenameList.tsx). Set
 *  through the same PUT .../speakers rename endpoint as any other name, but
 *  speakers/route.ts skips enrolling it into the company-wide voice
 *  directory so "Unknown" never becomes a fake, ever-growing profile that
 *  matches unrelated noisy clusters in future meetings. */
export const UNKNOWN_SPEAKER_NAME = "Unknown";

export type MeetingStatus = "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
export type AudioChunkStatus = "PENDING" | "UPLOADED" | "FAILED";
export type ActionItemStatus = "OPEN" | "IN_PROGRESS" | "DONE";

/** Row shape used by both the list (GET /api/meeting) and as the base of
 *  MeetingDetail (GET /api/meeting/[meetingId]) — the list never nests
 *  transcript/summary data, only these top-level fields. */
export interface Meeting {
  id: string;
  ownerEmail: string;
  title: string;
  status: MeetingStatus;
  audioUrl: string | null;
  durationSec: number | null;
  fileSizeBytes: number | null;
  mimeType: string | null;
  /** Whisper language code chosen on the "before you record" language
   *  picker (see lib/meeting/sttLanguages.ts) — what both the local and
   *  server STT providers transcribe this meeting as. */
  sttLanguage: string;
  /** Set only when status = FAILED; shown on the Processing screen. */
  failureReason: string | null;
  /** True when the current READY result is the mock-complete placeholder,
   *  not a real transcription — the result screen shows a "Retry" banner
   *  instead of presenting it as a finished transcript (see
   *  POST /api/meeting/[meetingId]/reprocess). */
  isMockResult: boolean;
  /** Set once "Create mindmap" has succeeded at least once — the
   *  WorkspaceBoard.id to link back to, so the header can show "View
   *  mindmap" instead of creating a new board on every click. */
  mindmapBoardId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Set only by GET /api/meeting (the list) — true when this meeting has
   *  at least one active (unrevoked, unexpired) share, whether the caller
   *  owns it and shared it out, or is themselves the invited viewer. Powers
   *  the small share icon in MeetingAsideRecentItem.tsx. */
  isShared?: boolean;
  /** True specifically when the caller is a viewer via share (not the
   *  owner) — lets the sidebar row read "Shared with you" instead of
   *  "Shared". */
  sharedWithMe?: boolean;
  /** Sidebar folder this meeting is filed under for the current caller, or
   *  null when ungrouped. For owned meetings this comes from Meeting.groupId;
   *  for shared-with-me rows GET /api/meeting overlays MeetingShare.groupId so
   *  each recipient can organize the same meeting independently. */
  groupId: string | null;
}

/** A user-defined personal sidebar folder for organizing owned or shared
 *  meetings (MeetingAside.tsx "New group" / "Move to group"). Deleting a
 *  group never deletes meetings — both Meeting.groupId and
 *  MeetingShare.groupId use onDelete: SetNull in prisma/schema.prisma. */
export interface MeetingGroup {
  id: string;
  ownerEmail: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/** POST /api/meeting/groups request body. */
export interface CreateMeetingGroupInput {
  name: string;
}

/** PATCH /api/meeting/groups/[groupId] request body — rename only for now. */
export interface UpdateMeetingGroupInput {
  name: string;
}

export interface AudioChunk {
  id: string;
  meetingId: string;
  sequence: number;
  storageUrl: string | null;
  durationSec: number | null;
  sizeBytes: number | null;
  status: AudioChunkStatus;
  createdAt: string;
}

/** A diarization-detected speaker slot (`speaker_1`, ...), written once by
 *  the STT pipeline. Never carries a display name — see SpeakerMapping. */
export interface Speaker {
  id: string;
  meetingId: string;
  speakerKey: string;
  createdAt: string;
}

/** The user-editable rename overlay: `speaker_1` -> "John". */
export interface SpeakerMapping {
  id: string;
  meetingId: string;
  speakerKey: string;
  displayName: string;
  updatedByEmail: string;
  updatedAt: string;
}

/** One STT-produced utterance. `speakerDisplayName` is resolved server-side
 *  by joining `speakerKey` against SpeakerMapping (falling back to the raw
 *  key when no mapping exists yet) — the UI never has to do that join
 *  itself. */
export interface TranscriptSegment {
  id: string;
  meetingId: string;
  speakerKey: string;
  speakerDisplayName: string;
  order: number;
  startTimeMs: number;
  endTimeMs: number;
  textEn: string | null;
  textVi: string | null;
}

/** A user-placed marker on the audio timeline (Transcript tab). */
export interface Bookmark {
  id: string;
  meetingId: string;
  timestampMs: number;
  label: string | null;
  createdByEmail: string;
  createdAt: string;
}

/** Evidence fields cite TranscriptSegment.id — the UI uses them to jump the
 *  audio player to the cited moment. */
export interface Topic {
  id: string;
  title: string;
  evidenceSegmentIds: string[];
  order: number;
}

export interface Decision {
  id: string;
  text: string;
  evidenceSegmentIds: string[];
  timestampMs: number | null;
}

export interface ActionItem {
  id: string;
  task: string;
  owner: string | null;
  deadline: string | null;
  status: ActionItemStatus;
  evidenceSegmentIds: string[];
  startTimeMs: number | null;
  endTimeMs: number | null;
}

export interface Blocker {
  id: string;
  text: string;
  evidenceSegmentIds: string[];
  timestampMs: number | null;
}

export interface OpenQuestion {
  id: string;
  text: string;
  evidenceSegmentIds: string[];
  timestampMs: number | null;
}

/** One dynamic overview section (step 1 of the "dynamic overview" feature —
 *  see lib/meeting/overviewSections.ts for the kind library and the item
 *  shape each kind carries). `items` is intentionally `unknown[]` here —
 *  callers narrow it with `parseSectionItems(kind, items)` before
 *  rendering, matching the DB layer where it's untyped JSON. */
export interface OverviewSection {
  id: string;
  kind: string;
  title: string;
  order: number;
  source: "ai" | "user";
  items: unknown[];
}

/** The AI-generated summary and its child findings, one per Meeting.
 *  `sections` is the new dynamic-overview representation (dual-written
 *  alongside decisions/actionItems/blockers/openQuestions in this step —
 *  see lib/meeting/ai/buildSummaryCreateInput.ts); the legacy arrays stay
 *  populated so existing consumers (translation, download, mindmap) keep
 *  working until they're migrated in a later step. */
export interface MeetingSummary {
  id: string;
  meetingId: string;
  overview: string;
  meetingLabel: string | null;
  topics: Topic[];
  decisions: Decision[];
  actionItems: ActionItem[];
  blockers: Blocker[];
  openQuestions: OpenQuestion[];
  sections: OverviewSection[];
  createdAt: string;
  updatedAt: string;
}

/** GET /api/meeting/[meetingId] response — everything the Meeting Result
 *  screen (Overview / Transcript / Ask tabs) needs in one fetch. */
export interface MeetingDetail extends Meeting {
  transcriptSegments: TranscriptSegment[];
  speakers: Speaker[];
  speakerMappings: SpeakerMapping[];
  bookmarks: Bookmark[];
  /** Null until the summarization step has produced a result. */
  summary: MeetingSummary | null;
  /** "owner" (rename/delete/manage shares allowed), "editor" (an active
   *  share grant with role "editor" — also sections/summary/minutes edit),
   *  or "viewer" (an active grant with role "viewer" — read + ask +
   *  translate only). See app/api/meeting/_access.ts. */
  accessRole: "owner" | MeetingShareRole;
}

/** One row in the Share dialog's list, and the shape POST .../shares
 *  accepts to create one. */
export interface MeetingShare {
  id: string;
  meetingId: string;
  invitedEmail: string;
  invitedBy: string;
  /** "viewer" (default) or "editor" — see MeetingShareRole. */
  role: MeetingShareRole;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

/** POST /api/meeting request body. */
export interface CreateMeetingInput {
  title: string;
  status?: MeetingStatus;
  audioUrl?: string | null;
  durationSec?: number | null;
  fileSizeBytes?: number | null;
  mimeType?: string | null;
  /** Whisper language code (see lib/meeting/sttLanguages.ts). Defaults to
   *  "vi" server-side when omitted or unrecognized. */
  sttLanguage?: string;
}

/** PUT /api/meeting/[meetingId]/speakers request body — renames or creates
 *  the mapping for one speakerKey. */
export interface UpdateSpeakerMappingInput {
  speakerKey: string;
  displayName: string;
}
