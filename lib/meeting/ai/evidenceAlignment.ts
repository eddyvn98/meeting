/**
 * Keeps AI evidence links valid when the first text-only transcript is later
 * replaced by the diarized/merged transcript.
 *
 * Overview generation can start as soon as STT text is saved, before speaker
 * detection finishes. The later diarization pass may merge/split transcript
 * rows, so evidence ids generated from the first save must be aligned to the
 * final rows by time instead of assuming row ids/counts stay identical.
 */

export interface EvidenceSourceSegment {
  start: number;
  end: number;
}

export interface PersistedEvidenceSegment {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
}

function bestMatchId(startMs: number, endMs: number, candidates: PersistedEvidenceSegment[]): string {
  if (candidates.length === 0) return "";

  let best = candidates[0];
  let bestOverlap = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  const sourceMid = (startMs + endMs) / 2;

  for (const candidate of candidates) {
    const overlap = Math.max(0, Math.min(endMs, candidate.endTimeMs) - Math.max(startMs, candidate.startTimeMs));
    const candidateMid = (candidate.startTimeMs + candidate.endTimeMs) / 2;
    const distance = Math.abs(sourceMid - candidateMid);
    if (overlap > bestOverlap || (overlap === bestOverlap && distance < bestDistance)) {
      best = candidate;
      bestOverlap = overlap;
      bestDistance = distance;
    }
  }

  return best.id;
}

/** Returns one current transcript id for every source transcript index. */
export function alignEvidenceSegmentIds(
  source: EvidenceSourceSegment[],
  current: PersistedEvidenceSegment[],
): string[] {
  return source.map((segment) =>
    bestMatchId(Math.round(segment.start * 1000), Math.round(segment.end * 1000), current),
  );
}

/** Maps ids from a replaced transcript snapshot to the nearest final row. */
export function buildEvidenceIdRemap(
  previous: PersistedEvidenceSegment[],
  current: PersistedEvidenceSegment[],
): Map<string, string> {
  return new Map(
    previous.map((segment) => [
      segment.id,
      bestMatchId(segment.startTimeMs, segment.endTimeMs, current),
    ]),
  );
}

/** Rewrites evidenceSegmentIds anywhere inside a section's JSON item tree. */
export function remapEvidenceInJson(value: unknown, idMap: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => remapEvidenceInJson(item, idMap));
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "evidenceSegmentIds" && Array.isArray(child)) {
      result[key] = child
        .filter((id): id is string => typeof id === "string")
        .map((id) => idMap.get(id) ?? id);
    } else {
      result[key] = remapEvidenceInJson(child, idMap);
    }
  }
  return result;
}
