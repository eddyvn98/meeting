-- CreateEnum
CREATE TYPE "MeetingBotStatus" AS ENUM (
  'REQUESTED',
  'CLAIMED',
  'JOINING',
  'LOBBY',
  'JOINED',
  'CAPTURING',
  'STOP_REQUESTED',
  'ENDED',
  'FAILED'
);

-- CreateTable
CREATE TABLE "meeting_bot_sessions" (
  "id" TEXT NOT NULL,
  "ownerEmail" TEXT NOT NULL,
  "meetingUrl" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" "MeetingBotStatus" NOT NULL DEFAULT 'REQUESTED',
  "runnerId" TEXT,
  "meetingId" TEXT,
  "lastHeartbeatAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "meeting_bot_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meeting_bot_sessions_meetingId_key" ON "meeting_bot_sessions"("meetingId");
CREATE INDEX "meeting_bot_sessions_ownerEmail_createdAt_idx" ON "meeting_bot_sessions"("ownerEmail", "createdAt");
CREATE INDEX "meeting_bot_sessions_status_requestedAt_idx" ON "meeting_bot_sessions"("status", "requestedAt");

-- AddForeignKey
ALTER TABLE "meeting_bot_sessions" ADD CONSTRAINT "meeting_bot_sessions_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
