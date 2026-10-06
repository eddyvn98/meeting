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

export type MeetingBotSource = "MANUAL" | "CALENDAR" | "SCHEDULE";

export type MeetingScheduleRepeat = "NONE" | "DAILY" | "WEEKDAYS" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

export interface MeetingBotSchedule {
  id: string;
  ownerEmail: string;
  meetingUrl: string;
  title: string;
  startAt: string;
  timezoneOffsetMin: number;
  nextRunAt: string | null;
  repeat: MeetingScheduleRepeat;
  enabled: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingBotSpeakerObservation {
  atMs: number;
  names: string[];
}

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
  participantNames: string[];
  attendeeEmails: string[];
  speakerObservations: MeetingBotSpeakerObservation[];
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
  participantNames?: string[];
  speakerObservations?: MeetingBotSpeakerObservation[];
}
