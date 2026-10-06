export interface ChunkRunProtocol {
  runId: string;
  chunkIndex: number;
  chunkCount: number;
}

export type ChunkRunParseResult =
  | { ok: true; value: ChunkRunProtocol }
  | { ok: false; error: string };

export function parseChunkRunHeaders(headers: Pick<Headers, "get">): ChunkRunParseResult {
  const runId = headers.get("x-chunk-run-id")?.trim() ?? "";
  const chunkIndex = Number(headers.get("x-chunk-index"));
  const chunkCount = Number(headers.get("x-chunk-count"));

  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(runId)) {
    return { ok: false, error: "x-chunk-run-id header is required" };
  }
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return { ok: false, error: "x-chunk-index must be a non-negative integer" };
  }
  if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > 100_000) {
    return { ok: false, error: "x-chunk-count must be a positive integer" };
  }
  if (chunkIndex >= chunkCount) {
    return { ok: false, error: "x-chunk-index must be smaller than x-chunk-count" };
  }

  return { ok: true, value: { runId, chunkIndex, chunkCount } };
}

export function missingChunkIndexes(received: Iterable<number>, chunkCount: number): number[] {
  const set = received instanceof Set ? received : new Set(received);
  const missing: number[] = [];
  for (let index = 0; index < chunkCount; index += 1) {
    if (!set.has(index)) missing.push(index);
  }
  return missing;
}

export const RETRYABLE_CHUNK_RUN_CODES = new Set([
  "CHUNK_RUN_LOST",
  "CHUNK_RUN_INCOMPLETE",
  "CHUNK_RUN_MISMATCH",
]);

export function isRetryableChunkRunCode(value: unknown): boolean {
  return typeof value === "string" && RETRYABLE_CHUNK_RUN_CODES.has(value);
}
