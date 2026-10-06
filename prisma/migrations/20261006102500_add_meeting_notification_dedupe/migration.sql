ALTER TABLE "meeting_notifications"
ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "meeting_notifications_dedupeKey_key"
ON "meeting_notifications"("dedupeKey");
