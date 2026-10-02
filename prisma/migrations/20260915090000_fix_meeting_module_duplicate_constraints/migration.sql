-- Reconcile: make the 11 Meeting module foreign keys idempotent.
--
-- 20260907120000_add_meeting_module ends with 11 bare
-- `ALTER TABLE ... ADD CONSTRAINT ...` statements. On staging, that
-- migration's tables/constraints were already created by hand (or by a
-- prior partial run) before `prisma migrate deploy` ever ran, so the first
-- deploy attempt hit Postgres 42710 (duplicate_object) on the first FK:
--
--   Error: P3018
--   ERROR: constraint "meeting_audio_chunks_meetingId_fkey" for relation
--   "meeting_audio_chunks" already exists
--
-- That failed attempt left 20260907120000_add_meeting_module recorded as
-- failed in `_prisma_migrations`, so every subsequent `migrate deploy` run
-- immediately refuses with P3009 ("migrate found failed migrations in the
-- target database") before it gets anywhere near this file.
--
-- Not editing 20260907120000_add_meeting_module directly: it has already
-- shipped and partially applied on staging, and Prisma migrations are
-- treated as an immutable, checksummed history — rewriting an applied one
-- only papers over the recorded failure instead of fixing the schema state
-- forward. Once .github/workflows/deploy.yml resolves that specific failed
-- migration as applied (see the deploy recovery step), `migrate deploy`
-- resumes normally and reaches this migration, which then guarantees all 11
-- FKs exist without ever dropping/recreating anything — safe whether they
-- were already created by hand, by the original migration, or not at all.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meeting_audio_chunks_meetingId_fkey'
    ) THEN
        ALTER TABLE "meeting_audio_chunks"
            ADD CONSTRAINT "meeting_audio_chunks_meetingId_fkey"
            FOREIGN KEY ("meetingId") REFERENCES "meetings"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meeting_speakers_meetingId_fkey'
    ) THEN
        ALTER TABLE "meeting_speakers"
            ADD CONSTRAINT "meeting_speakers_meetingId_fkey"
            FOREIGN KEY ("meetingId") REFERENCES "meetings"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meeting_speaker_mappings_meetingId_fkey'
    ) THEN
        ALTER TABLE "meeting_speaker_mappings"
            ADD CONSTRAINT "meeting_speaker_mappings_meetingId_fkey"
            FOREIGN KEY ("meetingId") REFERENCES "meetings"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meeting_transcript_segments_meetingId_fkey'
    ) THEN
        ALTER TABLE "meeting_transcript_segments"
            ADD CONSTRAINT "meeting_transcript_segments_meetingId_fkey"
            FOREIGN KEY ("meetingId") REFERENCES "meetings"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meeting_bookmarks_meetingId_fkey'
    ) THEN
        ALTER TABLE "meeting_bookmarks"
            ADD CONSTRAINT "meeting_bookmarks_meetingId_fkey"
            FOREIGN KEY ("meetingId") REFERENCES "meetings"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meeting_summaries_meetingId_fkey'
    ) THEN
        ALTER TABLE "meeting_summaries"
            ADD CONSTRAINT "meeting_summaries_meetingId_fkey"
            FOREIGN KEY ("meetingId") REFERENCES "meetings"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meeting_topics_summaryId_fkey'
    ) THEN
        ALTER TABLE "meeting_topics"
            ADD CONSTRAINT "meeting_topics_summaryId_fkey"
            FOREIGN KEY ("summaryId") REFERENCES "meeting_summaries"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meeting_decisions_summaryId_fkey'
    ) THEN
        ALTER TABLE "meeting_decisions"
            ADD CONSTRAINT "meeting_decisions_summaryId_fkey"
            FOREIGN KEY ("summaryId") REFERENCES "meeting_summaries"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meeting_action_items_summaryId_fkey'
    ) THEN
        ALTER TABLE "meeting_action_items"
            ADD CONSTRAINT "meeting_action_items_summaryId_fkey"
            FOREIGN KEY ("summaryId") REFERENCES "meeting_summaries"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meeting_blockers_summaryId_fkey'
    ) THEN
        ALTER TABLE "meeting_blockers"
            ADD CONSTRAINT "meeting_blockers_summaryId_fkey"
            FOREIGN KEY ("summaryId") REFERENCES "meeting_summaries"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'meeting_open_questions_summaryId_fkey'
    ) THEN
        ALTER TABLE "meeting_open_questions"
            ADD CONSTRAINT "meeting_open_questions_summaryId_fkey"
            FOREIGN KEY ("summaryId") REFERENCES "meeting_summaries"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
