/**
 * lib/meeting/stt/voiceLibrary.ts
 *
 * Server-side access to the company-wide voice library (MeetingVoiceProfile)
 * — see speakerClustering.ts's `seedProfiles` doc comment for why this is
 * NOT scoped per-user like MeetingGlossaryTerm. Used two ways:
 *   1. loadVoiceProfileSeeds() before diarization clustering (transcribe-
 *      chunk/route.ts server-side; GET .../voice-profiles below for the
 *      browser-run local path) so a previously-enrolled colleague's voice
 *      is auto-labeled instead of `speaker_N`.
 *   2. enrollVoiceProfile() when a user renames a speaker (speakers/
 *      route.ts) — teaches the library that voice's embedding under that
 *      name, averaged into any existing profile of the same name.
 */

import { prisma } from "@/lib/prisma";
import type { NamedSeedCentroid } from "./diarization/speakerClustering";

export async function loadVoiceProfileSeeds(): Promise<NamedSeedCentroid[]> {
  const rows = await prisma.meetingVoiceProfile.findMany();
  return rows
    .map((r) => ({ displayName: r.displayName, embedding: toFloat32(r.embeddingJson) }))
    .filter((r): r is NamedSeedCentroid => r.embedding !== null);
}

/** Averages `embedding` into the named profile's running centroid (creating
 *  it on first use) — same weighted-average approach as
 *  speakerClustering.ts's own updateCentroid, just persisted across
 *  meetings instead of across spans within one. */
export async function enrollVoiceProfile(displayName: string, embedding: Float32Array): Promise<void> {
  const existing = await prisma.meetingVoiceProfile.findUnique({ where: { displayName } });
  if (!existing) {
    await prisma.meetingVoiceProfile.create({
      data: { displayName, embeddingJson: Array.from(embedding), sampleCount: 1 },
    });
    return;
  }

  const previous = toFloat32(existing.embeddingJson);
  if (!previous || previous.length !== embedding.length) {
    // Dimension mismatch (e.g. the embedding model changed) — replace
    // rather than average incompatible vectors together.
    await prisma.meetingVoiceProfile.update({
      where: { displayName },
      data: { embeddingJson: Array.from(embedding), sampleCount: 1 },
    });
    return;
  }

  const newCount = existing.sampleCount + 1;
  const merged = new Array<number>(embedding.length);
  for (let i = 0; i < embedding.length; i++) {
    merged[i] = (previous[i] * existing.sampleCount + embedding[i]) / newCount;
  }
  await prisma.meetingVoiceProfile.update({
    where: { displayName },
    data: { embeddingJson: merged, sampleCount: newCount },
  });
}

export interface VoiceProfileSummary {
  displayName: string;
  sampleCount: number;
  updatedAt: string;
}

/** Lists the company-wide voice directory for the management UI (Speakers
 *  panel's "Voice directory" toggle) — unlike loadVoiceProfileSeeds this
 *  intentionally omits embeddingJson, which the UI never needs and is large
 *  enough to be wasteful to ship to the browser. */
export async function listVoiceProfiles(): Promise<VoiceProfileSummary[]> {
  const rows = await prisma.meetingVoiceProfile.findMany({ orderBy: { displayName: "asc" } });
  return rows.map((r) => ({
    displayName: r.displayName,
    sampleCount: r.sampleCount,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Removes one enrolled voice — e.g. the user renamed a speaker to the wrong
 *  name and wants the directory to stop auto-labeling that voice with it.
 *  Does not touch any meeting's existing SpeakerMapping rows. */
export async function deleteVoiceProfile(displayName: string): Promise<void> {
  await prisma.meetingVoiceProfile.delete({ where: { displayName } }).catch(() => {
    // Already gone — deleting a directory entry is idempotent from the UI's
    // point of view (two tabs, or a double-click).
  });
}

function toFloat32(json: unknown): Float32Array | null {
  if (!Array.isArray(json) || json.some((v) => typeof v !== "number")) return null;
  return new Float32Array(json as number[]);
}
