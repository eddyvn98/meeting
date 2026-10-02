-- Reconcile the Prisma schema with the original Meeting module migration.
--
-- The Meeting feature was expanded after
-- 20260907120000_add_meeting_module, but those schema changes were committed
-- without a follow-up migration.  `migrate deploy` therefore reported a
-- healthy database while runtime queries could still fail with P2021 (most
-- visibly on meeting_shares).  Keep this migration idempotent because the
-- staging recovery path may run against a database that was partially
-- repaired by hand.

ALTER TABLE "meeting_speakers"
  ADD COLUMN IF NOT EXISTS "embeddingJson" JSONB;

ALTER TABLE "meetings"
  ADD COLUMN IF NOT EXISTS "isMockResult" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "meeting_glossary_terms" (
    "id" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "meeting_glossary_terms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "meeting_voice_profiles" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "embeddingJson" JSONB NOT NULL,
    "sampleCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "meeting_voice_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "meeting_shares" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "invitedEmail" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "meeting_shares_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "meeting_glossary_terms_ownerEmail_idx"
  ON "meeting_glossary_terms"("ownerEmail");
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_glossary_terms_ownerEmail_term_key"
  ON "meeting_glossary_terms"("ownerEmail", "term");
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_voice_profiles_displayName_key"
  ON "meeting_voice_profiles"("displayName");
CREATE INDEX IF NOT EXISTS "meeting_shares_invitedEmail_idx"
  ON "meeting_shares"("invitedEmail");
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_shares_meetingId_invitedEmail_key"
  ON "meeting_shares"("meetingId", "invitedEmail");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'meeting_shares_meetingId_fkey'
  ) THEN
    ALTER TABLE "meeting_shares"
      ADD CONSTRAINT "meeting_shares_meetingId_fkey"
      FOREIGN KEY ("meetingId") REFERENCES "meetings"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
