-- Stage C of the MOM feature: meeting sharing grows an editor role.
-- Existing MeetingShare grants keep their current (read-only) behavior by
-- defaulting to VIEWER.

-- CreateEnum
CREATE TYPE "MeetingShareRole" AS ENUM ('VIEWER', 'EDITOR');

-- AlterTable
ALTER TABLE "meeting_shares" ADD COLUMN "role" "MeetingShareRole" NOT NULL DEFAULT 'VIEWER';
