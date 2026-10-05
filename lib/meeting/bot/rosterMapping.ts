export interface RosterSpeakerObservation {
  atMs: number;
  names: string[];
}

export interface RosterSpeakerMapping {
  speakerKey: string;
  displayName: string;
  votes: number;
  confidence: number;
}

const MAX_PARTICIPANTS = 200;
const MAX_NAME_LENGTH = 160;
const MAX_OBSERVATIONS = 5000;

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  return name || null;
}

export function sanitizeParticipantNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const name = cleanName(value);
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= MAX_PARTICIPANTS) break;
  }
  return names;
}

export function parseSpeakerObservations(raw: unknown): RosterSpeakerObservation[] {
  if (!Array.isArray(raw)) return [];
  const result: RosterSpeakerObservation[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.atMs !== "number" || !Number.isFinite(row.atMs) || row.atMs < 0) continue;
    const names = sanitizeParticipantNames(row.names).slice(0, 4);
    if (names.length === 0) continue;
    result.push({ atMs: Math.round(row.atMs), names });
    if (result.length >= MAX_OBSERVATIONS) break;
  }
  return result;
}

interface TimedSpeakerSegment {
  speakerKey: string;
  startTimeMs: number;
  endTimeMs: number;
}

const normalize = (name: string) => name.trim().toLocaleLowerCase();

export function inferRosterSpeakerMappings({
  segments,
  participantNames,
  observations,
  existingMappings = [],
  toleranceMs = 1500,
}: {
  segments: TimedSpeakerSegment[];
  participantNames: string[];
  observations: RosterSpeakerObservation[];
  existingMappings?: Array<{ speakerKey: string; displayName: string }>;
  toleranceMs?: number;
}): RosterSpeakerMapping[] {
  const canonicalNames = new Map(
    sanitizeParticipantNames(participantNames).map((name) => [normalize(name), name]),
  );
  if (canonicalNames.size === 0 || segments.length === 0 || observations.length === 0) return [];

  const scores = new Map<string, Map<string, number>>();
  for (const observation of observations) {
    if (observation.names.length !== 1) continue;
    const canonical = canonicalNames.get(normalize(observation.names[0]));
    if (!canonical) continue;

    let best: TimedSpeakerSegment | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const segment of segments) {
      if (observation.atMs < segment.startTimeMs - toleranceMs) continue;
      if (observation.atMs > segment.endTimeMs + toleranceMs) continue;
      const distance =
        observation.atMs < segment.startTimeMs
          ? segment.startTimeMs - observation.atMs
          : observation.atMs > segment.endTimeMs
            ? observation.atMs - segment.endTimeMs
            : 0;
      if (distance < bestDistance) {
        best = segment;
        bestDistance = distance;
      }
    }
    if (!best) continue;
    const byName = scores.get(best.speakerKey) ?? new Map<string, number>();
    byName.set(canonical, (byName.get(canonical) ?? 0) + 1);
    scores.set(best.speakerKey, byName);
  }

  const reservedKeys = new Set(existingMappings.map((m) => m.speakerKey));
  const usedNames = new Set(existingMappings.map((m) => normalize(m.displayName)));
  const proposals: RosterSpeakerMapping[] = [];
  for (const [speakerKey, byName] of scores) {
    if (reservedKeys.has(speakerKey)) continue;
    const ranked = [...byName.entries()].sort((a, b) => b[1] - a[1]);
    const [topName, topVotes] = ranked[0] ?? [];
    if (!topName || !topVotes || topVotes < 2) continue;
    const total = ranked.reduce((sum, [, votes]) => sum + votes, 0);
    const secondVotes = ranked[1]?.[1] ?? 0;
    const confidence = total > 0 ? topVotes / total : 0;
    if (confidence < 0.6 || (secondVotes > 0 && topVotes < secondVotes * 1.5)) continue;
    proposals.push({ speakerKey, displayName: topName, votes: topVotes, confidence });
  }

  proposals.sort((a, b) => b.confidence - a.confidence || b.votes - a.votes);
  const accepted: RosterSpeakerMapping[] = [];
  for (const proposal of proposals) {
    const nameKey = normalize(proposal.displayName);
    if (usedNames.has(nameKey)) continue;
    usedNames.add(nameKey);
    accepted.push(proposal);
  }
  return accepted;
}
