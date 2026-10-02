/**
 * lib/meeting/stt/diarization/speakerClustering.ts
 *
 * pyannote/segmentation-3.0 only labels speakers LOCALLY within whatever
 * window localDiarizationProvider.ts fed it (e.g. "local speaker 1" in
 * minute 0-1 has no relation to "local speaker 1" in minute 5-6). This
 * module assigns a single STABLE speakerIndex across the whole recording by
 * greedily clustering per-window speaker-embedding vectors (from a
 * WeSpeaker embedding model) by cosine similarity — the same "incremental
 * clustering against running centroids" approach used in transformers.js's
 * own speaker-diarization demos, simpler than full agglomerative clustering
 * and good enough for a meeting's handful of speakers.
 *
 * `seedProfiles` (optional) extends this ACROSS meetings: the caller passes
 * in the company-wide voice library (MeetingVoiceProfile rows — see
 * providerFactory.ts callers), one named centroid per previously-enrolled
 * colleague. A span matching a seed closely enough joins that centroid and
 * inherits its name (`recognizedName`) instead of getting an anonymous
 * `speaker_N` slot — so a colleague renamed once, in any past meeting the
 * company has processed, is auto-labeled in every future one. Seeds are
 * tried FIRST (in seed order) for every span exactly like any other
 * centroid — a span can still win an anonymous cluster instead if it's
 * closer to that.
 *
 * Pure (no model/audio) so it's unit-testable with synthetic embeddings.
 */

export interface EmbeddingSpan {
  embedding: Float32Array;
  startTime: number;
  duration: number;
}

export interface ClusteredSpan {
  startTime: number;
  duration: number;
  speakerIndex: number;
  /** Set only when this span matched a seeded voice-library centroid. */
  recognizedName?: string;
}

/** Final centroid per speakerIndex, in the same order/indexing as
 *  ClusteredSpan.speakerIndex — for persisting onto Speaker.embeddingJson
 *  (transcript/route.ts) so a LATER rename can enroll it into the voice
 *  library even though the raw per-span embeddings themselves are never
 *  persisted. */
export interface SpeakerCentroid {
  speakerIndex: number;
  embedding: Float32Array;
  recognizedName?: string;
}

export interface ClusterResult {
  spans: ClusteredSpan[];
  centroids: SpeakerCentroid[];
}

export interface NamedSeedCentroid {
  displayName: string;
  embedding: Float32Array;
}

import {
  type Centroid,
  cosineSimilarity,
  updateCentroid,
  mergeSmallClusters,
  MIN_CLUSTER_SPANS,
  MIN_MERGE_SIMILARITY,
} from "./clusterMerging";

const MIN_DURATION_FOR_NEW_CLUSTER = 1.5;

/**
 * Assigns a stable `speakerIndex` (0-based) to each span by nearest-centroid
 * matching: a span joins the most-similar existing cluster if similarity
 * clears `similarityThreshold`, otherwise it starts a new cluster. Seed
 * centroids (from `seedProfiles`) occupy the first indexes, in the order
 * given. Processes spans in start-time order so identity assignment is
 * deterministic and centroids reflect only past speech, never future speech
 * the pipeline "shouldn't know about yet". A post-pass then folds any
 * resulting tiny clusters into the nearest real one — see
 * `mergeSmallClusters`.
 */
export function clusterSpansBySpeaker(
  spans: EmbeddingSpan[],
  seedProfiles: NamedSeedCentroid[] = [],
  similarityThreshold = 0.75,
): ClusterResult {
  const ordered = [...spans].sort((a, b) => a.startTime - b.startTime);
  const centroids: Centroid[] = seedProfiles.map((p) => ({ embedding: p.embedding, count: 1, name: p.displayName }));
  const result: ClusteredSpan[] = [];

  for (const span of ordered) {
    let bestIndex = -1;
    let bestSimilarity = -Infinity;
    for (let i = 0; i < centroids.length; i++) {
      const similarity = cosineSimilarity(span.embedding, centroids[i].embedding);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestIndex = i;
      }
    }

    // A short span is never allowed to found a new speaker — only a
    // long-enough one has a reliable-enough embedding for that call. If no
    // centroid exists yet at all (very start of the recording, or every span
    // so far was short), it still has to start one; there is nothing else to
    // join.
    const canFoundNewCluster = span.duration >= MIN_DURATION_FOR_NEW_CLUSTER || centroids.length === 0;

    let speakerIndex: number;
    if (bestIndex !== -1 && (bestSimilarity >= similarityThreshold || !canFoundNewCluster)) {
      speakerIndex = bestIndex;
      const centroid = centroids[bestIndex];
      // A short span forced to join here (via !canFoundNewCluster) can still
      // be a poor match — bestSimilarity has no floor in that branch. Only
      // fold it into the running centroid when the match clears a sane
      // floor, so a clearly-different voice doesn't degrade the centroid
      // (and therefore every future comparison against this speaker) just
      // because a brief interjection had nowhere else to go.
      if (bestSimilarity >= MIN_MERGE_SIMILARITY) {
        centroids[bestIndex] = {
          embedding: updateCentroid(centroid.embedding, centroid.count, span.embedding),
          count: centroid.count + 1,
          name: centroid.name,
        };
      }
    } else {
      speakerIndex = centroids.length;
      centroids.push({ embedding: span.embedding, count: 1 });
    }

    result.push({
      startTime: span.startTime,
      duration: span.duration,
      speakerIndex,
      recognizedName: centroids[speakerIndex].name,
    });
  }

  mergeSmallClusters(result, centroids, seedProfiles.length, MIN_CLUSTER_SPANS);

  // Merging already repoints every affected span's speakerIndex at its
  // surviving target IN PLACE (same physical index) — so, same as before
  // this pass existed, indices are never renumbered/compacted here, just
  // filtered: an unmatched seed (never had a match) or a tombstoned cluster
  // (merged away above, count 0) is dropped from the returned list, but a
  // surviving index keeps its original value even if that leaves gaps.
  const finalCentroids: SpeakerCentroid[] = centroids
    .map((c, speakerIndex) => ({ speakerIndex, embedding: c.embedding, recognizedName: c.name }))
    .filter((c, i) => {
      if (i < seedProfiles.length) return result.some((r) => r.speakerIndex === i);
      return centroids[i].count > 0;
    });

  return { spans: result, centroids: finalCentroids };
}
