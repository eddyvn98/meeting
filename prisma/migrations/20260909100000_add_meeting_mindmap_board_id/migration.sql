-- Tracks the WorkspaceBoard created by "Create mindmap" (see
-- app/api/meeting/[meetingId]/mindmap/route.ts) so the meeting page can link
-- straight back to it instead of only working right after creation.
-- Nullable, no backfill needed.

ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "mindmapBoardId" TEXT;
