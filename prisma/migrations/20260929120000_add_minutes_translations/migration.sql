-- CreateTable
CREATE TABLE "meeting_minutes_translations" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_minutes_translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meeting_minutes_translations_meetingId_language_key" ON "meeting_minutes_translations"("meetingId", "language");

-- AddForeignKey
ALTER TABLE "meeting_minutes_translations" ADD CONSTRAINT "meeting_minutes_translations_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
