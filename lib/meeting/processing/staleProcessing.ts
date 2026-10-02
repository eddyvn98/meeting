/**
 * lib/meeting/processing/staleProcessing.ts
 *
 * Pure staleness check shared by the reprocess route (allows an owner to
 * retry immediately instead of waiting on the sweep) and mirrored by the
 * claim route's recovery sweep query (app/api/meeting/bot-sessions/
 * claim/route.ts) and by scripts/meeting-bot-lifecycle.mjs's equivalent
 * check for the runner's own processing-wait timeout. Kept as one-line
 * logic rather than a shared cross-language import so the .ts route code
 * and the plain-Node .mjs runner script never need a build step between
 * them.
 */
export function isStaleProcessing(status: string, updatedAtMs: number, nowMs: number, staleMs: number): boolean {
  if (status !== "PROCESSING") return false;
  if (!Number.isFinite(updatedAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(staleMs)) return false;
  return nowMs - updatedAtMs >= staleMs;
}
