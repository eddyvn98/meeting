-- Add recurring schedules owned by the Meeting app itself.
CREATE TYPE "MeetingScheduleRepeat" AS ENUM ('NONE', 'DAILY', 'WEEKDAYS', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');

ALTER TYPE "MeetingBotSource" ADD VALUE IF NOT EXISTS 'SCHEDULE';

CREATE TABLE "meeting_bot_schedules" (
  "id" TEXT NOT NULL,
  "ownerEmail" TEXT NOT NULL,
  "meetingUrl" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "startAt" TIMESTAMP(3) NOT NULL,
  "nextRunAt" TIMESTAMP(3),
  "repeat" "MeetingScheduleRepeat" NOT NULL DEFAULT 'NONE',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastTriggeredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "meeting_bot_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "meeting_bot_schedules_ownerEmail_nextRunAt_idx"
ON "meeting_bot_schedules"("ownerEmail", "nextRunAt");

CREATE INDEX "meeting_bot_schedules_enabled_nextRunAt_idx"
ON "meeting_bot_schedules"("enabled", "nextRunAt");
