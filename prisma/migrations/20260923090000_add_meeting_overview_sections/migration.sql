-- Step 1 of the "dynamic overview" feature: add MeetingOverviewSection and
-- MeetingSummary.meetingLabel, then backfill sections from the existing
-- legacy tables (ActionItem/Decision/Blocker/OpenQuestion) so every current
-- summary renders identically through the new sections-based UI. The legacy
-- tables are left untouched (dual-write continues from the app layer) and
-- are dropped in a later migration once editing lands.

ALTER TABLE "meeting_summaries" ADD COLUMN "meetingLabel" TEXT;

CREATE TABLE "meeting_overview_sections" (
    "id" TEXT NOT NULL,
    "summaryId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ai',
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_overview_sections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "meeting_overview_sections_summaryId_idx" ON "meeting_overview_sections"("summaryId");

ALTER TABLE "meeting_overview_sections"
  ADD CONSTRAINT "meeting_overview_sections_summaryId_fkey"
  FOREIGN KEY ("summaryId") REFERENCES "meeting_summaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: "Action Items" (order 0) — always created, even when empty, so
-- the section list length/order matches the old fixed 3-card layout.
INSERT INTO "meeting_overview_sections" ("id", "summaryId", "kind", "title", "order", "source", "items", "createdAt", "updatedAt")
SELECT
  'mos_' || substr(md5(s."id" || ':actions'), 1, 20),
  s."id",
  'actions',
  'Action Items',
  0,
  'ai',
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', a."id",
          'task', a."task",
          'owner', a."owner",
          'deadline', to_char(a."deadline" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'done', a."status" = 'DONE',
          'evidenceSegmentIds', to_jsonb(a."evidenceSegmentIds")
        )
        ORDER BY a."createdAt"
      )
      FROM "meeting_action_items" a
      WHERE a."summaryId" = s."id"
    ),
    '[]'::jsonb
  ),
  s."createdAt",
  s."updatedAt"
FROM "meeting_summaries" s;

-- Backfill: "Decisions" (order 1) — always created.
INSERT INTO "meeting_overview_sections" ("id", "summaryId", "kind", "title", "order", "source", "items", "createdAt", "updatedAt")
SELECT
  'mos_' || substr(md5(s."id" || ':decisions'), 1, 20),
  s."id",
  'decisions',
  'Decisions',
  1,
  'ai',
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', d."id",
          'text', d."text",
          'evidenceSegmentIds', to_jsonb(d."evidenceSegmentIds")
        )
        ORDER BY d."createdAt"
      )
      FROM "meeting_decisions" d
      WHERE d."summaryId" = s."id"
    ),
    '[]'::jsonb
  ),
  s."createdAt",
  s."updatedAt"
FROM "meeting_summaries" s;

-- Backfill: "Blockers" (order 2) — always created.
INSERT INTO "meeting_overview_sections" ("id", "summaryId", "kind", "title", "order", "source", "items", "createdAt", "updatedAt")
SELECT
  'mos_' || substr(md5(s."id" || ':blockers'), 1, 20),
  s."id",
  'blockers',
  'Blockers',
  2,
  'ai',
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', b."id",
          'text', b."text",
          'evidenceSegmentIds', to_jsonb(b."evidenceSegmentIds")
        )
        ORDER BY b."createdAt"
      )
      FROM "meeting_blockers" b
      WHERE b."summaryId" = s."id"
    ),
    '[]'::jsonb
  ),
  s."createdAt",
  s."updatedAt"
FROM "meeting_summaries" s;

-- Backfill: "Open Questions" (order 3) — skipped for summaries that have
-- none, unlike actions/decisions/blockers above.
INSERT INTO "meeting_overview_sections" ("id", "summaryId", "kind", "title", "order", "source", "items", "createdAt", "updatedAt")
SELECT
  'mos_' || substr(md5(s."id" || ':open_questions'), 1, 20),
  s."id",
  'open_questions',
  'Open Questions',
  3,
  'ai',
  jsonb_agg(
    jsonb_build_object(
      'id', q."id",
      'text', q."text",
      'evidenceSegmentIds', to_jsonb(q."evidenceSegmentIds")
    )
    ORDER BY q."createdAt"
  ),
  s."createdAt",
  s."updatedAt"
FROM "meeting_summaries" s
JOIN "meeting_open_questions" q ON q."summaryId" = s."id"
GROUP BY s."id", s."createdAt", s."updatedAt";
