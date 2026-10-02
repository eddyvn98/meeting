export const MEETING_BOT_STATUSES = [
  "REQUESTED",
  "CLAIMED",
  "JOINING",
  "LOBBY",
  "JOINED",
  "CAPTURING",
  "STOP_REQUESTED",
  "ENDED",
  "FAILED",
] as const;

export type MeetingBotStatus = (typeof MEETING_BOT_STATUSES)[number];

export type MeetingBotSource = "MANUAL" | "CALENDAR";

export interface MeetingBotSession {
  id: string;
  ownerEmail: string;
  meetingUrl: string;
  title: string;
  source: MeetingBotSource;
  sourceKey: string | null;
  scheduledAt: string | null;
  status: MeetingBotStatus;
  runnerId: string | null;
  meetingId: string | null;
  lastHeartbeatAt: string | null;
  errorMessage: string | null;
  requestedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingBotEventInput {
  status: MeetingBotStatus;
  meetingId?: string;
  errorMessage?: string;
}
