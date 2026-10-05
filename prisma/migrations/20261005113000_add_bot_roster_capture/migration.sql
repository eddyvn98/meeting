ALTER TABLE "meeting_bot_sessions"
ADD COLUMN "participantNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "speakerObservations" JSONB;
