ALTER TABLE "meeting_bot_sessions"
ADD COLUMN "presentAttendeeEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "meeting_bot_sessions_presentAttendeeEmails_idx"
ON "meeting_bot_sessions" USING GIN ("presentAttendeeEmails");
