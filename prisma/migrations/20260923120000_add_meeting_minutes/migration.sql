-- Stage A of the MOM (Minutes of Meeting) feature: MeetingMinutes (1:1 MOM
-- header/footer metadata per meeting) and MeetingPersonRole (remembered
-- attendee roles per owner). The attendance list and matters table
-- themselves are NOT new tables — they're ordinary MeetingOverviewSection
-- rows with kind "attendance" / "minutes_table" (see
-- lib/meeting/overviewSections.ts), which already exists.

CREATE TABLE "meeting_minutes" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "title" TEXT,
    "meetingDate" TEXT,
    "timeRange" TEXT,
    "venue" TEXT,
    "footnote" TEXT,
    "recordedBy" TEXT,
    "recordedDate" TEXT,
    "distributed" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_minutes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meeting_minutes_meetingId_key" ON "meeting_minutes"("meetingId");

ALTER TABLE "meeting_minutes"
  ADD CONSTRAINT "meeting_minutes_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "meeting_person_roles" (
    "id" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_person_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meeting_person_roles_ownerEmail_normalizedName_key" ON "meeting_person_roles"("ownerEmail", "normalizedName");
