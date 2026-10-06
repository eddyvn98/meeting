"use client";

/**
 * lib/meeting/stt/chunkedServerTranscription.ts
 *
 * Long recordings are sent sequentially in bounded PCM slices. Every
 * whole-meeting attempt carries a run id and explicit chunk index/count.
 * Non-text mode depends on server accumulator state for whole-meeting speaker
 * clustering; if that state is lost after a process restart, the server
 * returns a retryable 409 and this client restarts once from chunk 0.
 */

import type { STTSegment, DiarizationSpan } from "./types";
import { encodeFloat32AsInt16Pcm } from "./serverProvider";
import { CHUNK_DURATION_SEC } from "./chunkConstants";
import type { SpeakerCentroid } from "./diarization/speakerClustering";
import { isRetryableChunkRunCode } from "./chunkRunProtocol";

interface ChunkResponseBody {
  segments?: { start: number; end: number; text: string }[];
  spans?: {
    startTime: number;
    duration: number;
    speakerId: string;
    speakerIndex: number;
    recognizedName?: string;
  }[];
  centroids?: { speakerIndex: number; embedding: number[]; recognizedName?: string }[];
}

const MAX_RUN_ATTEMPTS = 2;

export async function runChunkedServerTranscription(
  meetingId: string,
  audio: Float32Array,
  sampleRate: number,
  onChunkComplete?: (chunkIndex: number, chunkCount: number) => void,
  options: { textOnly?: boolean } = {},
): Promise<{ segments: STTSegment[]; spans: DiarizationSpan[]; centroids: SpeakerCentroid[] }> {
  const chunkSamples = CHUNK_DURATION_SEC * sampleRate;
  const chunkCount = Math.max(1, Math.ceil(audio.length / chunkSamples));

  for (let runAttempt = 0; runAttempt < MAX_RUN_ATTEMPTS; runAttempt += 1) {
    const runId = globalThis.crypto.randomUUID();
    let final: ChunkResponseBody = {};
    const textOnlySegments: STTSegment[] = [];
    let restartRun = false;

    for (let i = 0; i < chunkCount; i++) {
      const start = i * chunkSamples;
      const slice = audio.subarray(start, Math.min(start + chunkSamples, audio.length));
      const offsetSec = start / sampleRate;
      const isLast = i === chunkCount - 1;

      let res: Response;
      for (let attempt = 0; ; attempt++) {
        res = await fetch(`/api/meeting/${encodeURIComponent(meetingId)}/transcribe-chunk`, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-sample-rate": String(sampleRate),
            "x-chunk-offset-sec": String(offsetSec),
            "x-chunk-run-id": runId,
            "x-chunk-index": String(i),
            "x-chunk-count": String(chunkCount),
            "x-chunk-last": isLast ? "true" : "false",
            ...(options.textOnly ? { "x-text-only": "true" } : {}),
          },
          body: encodeFloat32AsInt16Pcm(slice),
        });
        if (res.status !== 429 || attempt >= 4) break;
        const retryAfterSec = Number(res.headers.get("Retry-After")) || 5;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(15, retryAfterSec) * 1000),
        );
      }

      if (!res.ok) {
        const errorBody = (await res.json().catch(() => null)) as {
          code?: unknown;
          error?: string;
        } | null;
        if (
          !options.textOnly &&
          res.status === 409 &&
          runAttempt < MAX_RUN_ATTEMPTS - 1 &&
          isRetryableChunkRunCode(errorBody?.code)
        ) {
          restartRun = true;
          break;
        }
        throw new Error(
          `Chunked transcribe request failed (chunk ${i + 1}/${chunkCount}): ${res.status}${errorBody?.error ? ` ${errorBody.error}` : ""}`,
        );
      }

      if (options.textOnly) {
        const data = (await res.json()) as ChunkResponseBody;
        textOnlySegments.push(
          ...(data.segments ?? []).map((s) => ({
            start: s.start,
            end: s.end,
            text: s.text,
          })),
        );
      } else if (isLast) {
        final = (await res.json()) as ChunkResponseBody;
      }

      onChunkComplete?.(i + 1, chunkCount);
    }

    if (restartRun) continue;

    if (options.textOnly) {
      textOnlySegments.sort((a, b) => a.start - b.start);
      return { segments: textOnlySegments, spans: [], centroids: [] };
    }

    return {
      segments: (final.segments ?? []).map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
      })),
      spans: final.spans ?? [],
      centroids: (final.centroids ?? []).map((c) => ({
        ...c,
        embedding: new Float32Array(c.embedding),
      })),
    };
  }

  throw new Error("Chunked transcription could not recover after the server lost chunk state.");
}
