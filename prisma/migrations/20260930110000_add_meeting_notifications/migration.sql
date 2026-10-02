-- Bell notifications for the Meeting module (comments, replies, invitations).
CREATE TABLE "meeting_notifications" (
    "id" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "anchorId" TEXT,
    "commentId" TEXT,
    "actorEmail" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailedAt" TIMESTAMP(3),

    CONSTRAINT "meeting_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "meeting_notifications_recipientEmail_createdAt_idx" ON "meeting_notifications"("recipientEmail", "createdAt");
CREATE INDEX "meeting_notifications_meetingId_idx" ON "meeting_notifications"("meetingId");

ALTER TABLE "meeting_notifications" ADD CONSTRAINT "meeting_notifications_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
