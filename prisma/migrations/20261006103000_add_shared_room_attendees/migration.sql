ALTER TABLE "meeting_bot_sessions"
ADD COLUMN "attendeeEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "meeting_bot_sessions_attendeeEmails_idx"
ON "meeting_bot_sessions" USING GIN ("attendeeEmails");
