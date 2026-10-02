CREATE TYPE "MeetingBotSource" AS ENUM ('MANUAL', 'CALENDAR');

ALTER TABLE "meeting_bot_sessions"
  ADD COLUMN "source" "MeetingBotSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "sourceKey" TEXT,
  ADD COLUMN "scheduledAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "meeting_bot_sessions_source_sourceKey_key"
  ON "meeting_bot_sessions"("source", "sourceKey");
