-- Shared meetings need recipient-specific sidebar placement.
-- Meeting.groupId remains the owner's folder assignment; MeetingShare.groupId
-- stores where the invited user filed that shared meeting in their own sidebar.

ALTER TABLE "meeting_shares" ADD COLUMN IF NOT EXISTS "groupId" TEXT;
CREATE INDEX IF NOT EXISTS "meeting_shares_groupId_idx" ON "meeting_shares"("groupId");

DO $$
BEGIN
    ALTER TABLE "meeting_shares" ADD CONSTRAINT "meeting_shares_groupId_fkey"
        FOREIGN KEY ("groupId") REFERENCES "meeting_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
