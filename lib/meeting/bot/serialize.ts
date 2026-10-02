import type { MeetingBotSession as PrismaMeetingBotSession } from "@prisma/client";
import type { MeetingBotSession } from "./types";

export function serializeMeetingBotSession(row: PrismaMeetingBotSession): MeetingBotSession {
  return {
    id: row.id,
    ownerEmail: row.ownerEmail,
    meetingUrl: row.meetingUrl,
    title: row.title,
    source: row.source,
    sourceKey: row.sourceKey,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    status: row.status,
    runnerId: row.runnerId,
    meetingId: row.meetingId,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    errorMessage: row.errorMessage,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
