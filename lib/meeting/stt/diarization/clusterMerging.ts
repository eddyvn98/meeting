/**
 * lib/meeting/stt/diarization/clusterMerging.ts
 *
 * Post-pass clustering helpers: cosine similarity, running centroid updates,
 * and merging stray small clusters into nearest surviving speaker clusters.
 */

import type { ClusteredSpan } from "./speakerClustering";

export interface Centroid {
  embedding: Float32Array;
  count: number;
  name?: string;
}

export const MIN_CLUSTER_SPANS = 8;
export const MIN_MERGE_SIMILARITY = 0.5;

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function updateCentroid(centroid: Float32Array, count: number, embedding: Float32Array): Float32Array {
  const updated = new Float32Array(centroid.length);
  const newCount = count + 1;
  for (let i = 0; i < updated.length; i++) {
    updated[i] = (centroid[i] * count + embedding[i]) / newCount;
  }
  return updated;
}

/**
 * Folds tiny (< `minSpans`) anonymous clusters into whichever other
 * anonymous cluster their centroid is closest to.
 */
export function mergeSmallClusters(
  result: ClusteredSpan[],
  centroids: Centroid[],
  seedCount: number,
  minSpans: number,
): void {
  const countOf = (idx: number) => result.filter((r) => r.speakerIndex === idx).length;
  const settled = new Set<number>();

  for (;;) {
    const anonymousIndexes = centroids.map((_, i) => i).filter((i) => i >= seedCount && centroids[i].count > 0);
    if (anonymousIndexes.length <= 1) break;

    const small = anonymousIndexes
      .map((i) => ({ i, count: countOf(i) }))
      .filter((c) => c.count < minSpans && !settled.has(c.i))
      .sort((a, b) => a.count - b.count)[0];
    if (!small) break;

    let bestTarget = -1;
    let bestSimilarity = -Infinity;
    for (const i of anonymousIndexes) {
      if (i === small.i) continue;
      const similarity = cosineSimilarity(centroids[small.i].embedding, centroids[i].embedding);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestTarget = i;
      }
    }
    if (bestTarget === -1 || bestSimilarity < MIN_MERGE_SIMILARITY) {
      settled.add(small.i);
      continue;
    }

    const source = centroids[small.i];
    const target = centroids[bestTarget];
    const mergedCount = source.count + target.count;
    const mergedEmbedding = new Float32Array(target.embedding.length);
    for (let d = 0; d < mergedEmbedding.length; d++) {
      mergedEmbedding[d] = (target.embedding[d] * target.count + source.embedding[d] * source.count) / mergedCount;
    }
    centroids[bestTarget] = { embedding: mergedEmbedding, count: mergedCount, name: target.name };
    for (const span of result) {
      if (span.speakerIndex === small.i) span.speakerIndex = bestTarget;
    }
    centroids[small.i] = { embedding: source.embedding, count: 0 };
  }

  for (const i of settled) {
    if (centroids[i].count === 0) continue;
    const alive = centroids.map((_, j) => j).filter((j) => j >= seedCount && j !== i && centroids[j].count > 0);
    if (alive.length === 0) continue;

    let bestTarget = alive[0];
    let bestSimilarity = -Infinity;
    for (const j of alive) {
      const similarity = cosineSimilarity(centroids[i].embedding, centroids[j].embedding);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestTarget = j;
      }
    }
    // Phase 1 above only ever added a cluster to `settled` because nothing
    // met MIN_MERGE_SIMILARITY for it — sweeping it into whatever is least-
    // dissimilar here regardless of that same threshold contradicts that
    // decision and can misattribute a real, distinct (just low-talk-time)
    // speaker's whole cluster to someone they don't actually sound like.
    // Leave it as its own speaker instead of force-merging a bad match.
    if (bestSimilarity < MIN_MERGE_SIMILARITY) continue;

    const source = centroids[i];
    const target = centroids[bestTarget];
    const mergedCount = source.count + target.count;
    const mergedEmbedding = new Float32Array(target.embedding.length);
    for (let d = 0; d < mergedEmbedding.length; d++) {
      mergedEmbedding[d] = (target.embedding[d] * target.count + source.embedding[d] * source.count) / mergedCount;
    }
    centroids[bestTarget] = { embedding: mergedEmbedding, count: mergedCount, name: target.name };
    for (const span of result) {
      if (span.speakerIndex === i) span.speakerIndex = bestTarget;
    }
    centroids[i] = { embedding: source.embedding, count: 0 };
  }
}
