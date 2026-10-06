ALTER TABLE "meeting_bot_sessions"
ADD COLUMN "attendeeEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
