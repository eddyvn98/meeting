import type { MeetingPostprocessStatus } from "@/lib/meeting/types";

export const POSTPROCESS_RUNNING_STALE_MS = 2 * 60_000;

export function canRetryPostprocess(
  status: MeetingPostprocessStatus,
  updatedAtMs: number,
  nowMs: number,
  staleMs = POSTPROCESS_RUNNING_STALE_MS,
): boolean {
  if (status === "PENDING" || status === "FAILED") return true;
  if (status !== "RUNNING") return false;
  if (!Number.isFinite(updatedAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(staleMs)) {
    return false;
  }
  return nowMs - updatedAtMs >= staleMs;
}
