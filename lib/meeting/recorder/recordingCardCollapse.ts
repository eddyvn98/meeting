export const RECORDING_CARD_EXPANDED_STORAGE_KEY = "meeting.recordingCard.expanded";

/**
 * Parses a raw localStorage value for the recording card's expanded/collapsed
 * preference. Returns null when the value is missing or unrecognized, so the
 * caller can fall back to its own default.
 */
export function parseStoredExpanded(raw: string | null): boolean | null {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

/**
 * Whether the upload backlog (chunks recorded but not yet backed up) is large
 * enough to warrant a warning indicator, even when the recording card is
 * collapsed.
 */
export function hasUploadBacklog(uploadedCount: number, chunkCount: number, threshold = 2): boolean {
  if (chunkCount <= 0) return false;
  return chunkCount - uploadedCount >= threshold;
}
