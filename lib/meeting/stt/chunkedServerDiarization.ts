"use client";

/**
 * lib/meeting/stt/chunkedServerDiarization.ts
 *
 * Speaker detection on our server, without transcription. Every whole-meeting
 * attempt has a run id plus explicit chunk index/count. If the server loses
 * its process-local accumulator, the endpoint returns a retryable 409 and this
 * client restarts once from chunk 0 rather than accepting a partial result.
 */

import type { DiarizationSpan } from "./types";
import { encodeFloat32AsInt16Pcm } from "./serverProvider";
import { CHUNK_DURATION_SEC } from "./chunkConstants";
import type { SpeakerCentroid } from "./diarization/speakerClustering";
import { isRetryableChunkRunCode } from "./chunkRunProtocol";

interface DiarizeResponseBody {
  spans?: DiarizationSpan[];
  centroids?: { speakerIndex: number; embedding: number[]; recognizedName?: string }[];
}

const MAX_RUN_ATTEMPTS = 2;

export async function runChunkedServerDiarization(
  meetingId: string,
  audio: Float32Array,
  sampleRate: number,
): Promise<{ spans: DiarizationSpan[]; centroids: SpeakerCentroid[] }> {
  const chunkSamples = CHUNK_DURATION_SEC * sampleRate;
  const chunkCount = Math.max(1, Math.ceil(audio.length / chunkSamples));

  for (let runAttempt = 0; runAttempt < MAX_RUN_ATTEMPTS; runAttempt += 1) {
    const runId = globalThis.crypto.randomUUID();
    let final: DiarizeResponseBody = {};
    let restartRun = false;

    for (let i = 0; i < chunkCount; i++) {
      const start = i * chunkSamples;
      const slice = audio.subarray(start, Math.min(start + chunkSamples, audio.length));
      const isLast = i === chunkCount - 1;

      let res: Response;
      for (let attempt = 0; ; attempt++) {
        res = await fetch(`/api/meeting/${encodeURIComponent(meetingId)}/diarize-chunk`, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-sample-rate": String(sampleRate),
            "x-chunk-offset-sec": String(start / sampleRate),
            "x-chunk-run-id": runId,
            "x-chunk-index": String(i),
            "x-chunk-count": String(chunkCount),
            "x-chunk-last": isLast ? "true" : "false",
          },
          body: encodeFloat32AsInt16Pcm(slice),
        });
        if (res.status !== 429 || attempt >= 4) break;
        const retryAfterSec = Number(res.headers.get("Retry-After")) || 5;
        await new Promise((resolve) => setTimeout(resolve, Math.min(15, retryAfterSec) * 1000));
      }

      if (!res.ok) {
        const errorBody = (await res.json().catch(() => null)) as { code?: unknown; error?: string } | null;
        if (
          res.status === 409 &&
          runAttempt < MAX_RUN_ATTEMPTS - 1 &&
          isRetryableChunkRunCode(errorBody?.code)
        ) {
          restartRun = true;
          break;
        }
        throw new Error(
          `Speaker detection request failed (chunk ${i + 1}/${chunkCount}): ${res.status}${errorBody?.error ? ` ${errorBody.error}` : ""}`,
        );
      }

      if (isLast) final = (await res.json()) as DiarizeResponseBody;
    }

    if (restartRun) continue;

    return {
      spans: final.spans ?? [],
      centroids: (final.centroids ?? []).map((c) => ({
        ...c,
        embedding: new Float32Array(c.embedding),
      })),
    };
  }

  throw new Error("Speaker detection could not recover after the server lost chunk state.");
}
