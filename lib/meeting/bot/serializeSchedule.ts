import type { MeetingBotSchedule as PrismaMeetingBotSchedule } from "@prisma/client";
import type { MeetingBotSchedule } from "./types";

export function serializeMeetingBotSchedule(row: PrismaMeetingBotSchedule): MeetingBotSchedule {
  return {
    id: row.id,
    ownerEmail: row.ownerEmail,
    meetingUrl: row.meetingUrl,
    title: row.title,
    startAt: row.startAt.toISOString(),
    timezoneOffsetMin: row.timezoneOffsetMin,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    repeat: row.repeat,
    enabled: row.enabled,
    lastTriggeredAt: row.lastTriggeredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
