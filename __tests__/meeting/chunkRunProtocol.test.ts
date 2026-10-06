import { describe, expect, it } from "vitest";
import {
  isRetryableChunkRunCode,
  missingChunkIndexes,
  parseChunkRunHeaders,
} from "../../lib/meeting/stt/chunkRunProtocol";

function headers(values: Record<string, string>) {
  return new Headers(values);
}

describe("chunk run protocol", () => {
  it("parses a complete run identity", () => {
    expect(parseChunkRunHeaders(headers({
      "x-chunk-run-id": "run-123",
      "x-chunk-index": "2",
      "x-chunk-count": "5",
    }))).toEqual({
      ok: true,
      value: { runId: "run-123", chunkIndex: 2, chunkCount: 5 },
    });
  });

  it("rejects invalid indices and missing run ids", () => {
    expect(parseChunkRunHeaders(headers({
      "x-chunk-index": "0",
      "x-chunk-count": "2",
    })).ok).toBe(false);
    expect(parseChunkRunHeaders(headers({
      "x-chunk-run-id": "run",
      "x-chunk-index": "2",
      "x-chunk-count": "2",
    })).ok).toBe(false);
  });

  it("finds missing chunks before a final result is accepted", () => {
    expect(missingChunkIndexes(new Set([0, 2]), 4)).toEqual([1, 3]);
    expect(missingChunkIndexes([0, 1, 2], 3)).toEqual([]);
  });

  it("recognizes restart-safe retry codes", () => {
    expect(isRetryableChunkRunCode("CHUNK_RUN_LOST")).toBe(true);
    expect(isRetryableChunkRunCode("OTHER")).toBe(false);
  });
});
