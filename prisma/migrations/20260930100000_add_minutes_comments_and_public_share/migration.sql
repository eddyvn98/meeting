-- Anonymous read-only link to the Minutes page.
ALTER TABLE "meetings" ADD COLUMN "publicShareEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "meetings" ADD COLUMN "publicShareToken" TEXT;
CREATE UNIQUE INDEX "meetings_publicShareToken_key" ON "meetings"("publicShareToken");

-- Per-row comments on the Minutes table.
CREATE TABLE "meeting_minutes_comments" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "anchorId" TEXT NOT NULL,
    "parentId" TEXT,
    "authorEmail" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_minutes_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "meeting_minutes_comments_meetingId_createdAt_idx" ON "meeting_minutes_comments"("meetingId", "createdAt");
CREATE INDEX "meeting_minutes_comments_parentId_idx" ON "meeting_minutes_comments"("parentId");

ALTER TABLE "meeting_minutes_comments" ADD CONSTRAINT "meeting_minutes_comments_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_minutes_comments" ADD CONSTRAINT "meeting_minutes_comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "meeting_minutes_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
