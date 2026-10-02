"use client";

/**
 * lib/meeting/stt/chunkedServerTranscription.ts
 *
 * Chunked server-side transcription — used when providerFactory.ts's
 * capability detection resolved the SERVER tier (local WASM/WebGPU
 * unavailable or failed to load), or when a chunk of the local-tier path
 * (chunkedLocalTranscription.ts) throws mid-meeting and
 * runLocalMeetingProcessing.ts retries the whole thing via the server
 * instead. Meeting length plays no part in this choice — see
 * providerFactory.ts's getSTTProviders doc comment for why the old
 * duration-based forced-server routing was removed. Regardless of why the
 * server tier is in use, this still slices the already-decoded audio into
 * CHUNK_DURATION_SEC pieces and POSTs them SEQUENTIALLY to
 * transcribe-chunk/route.ts rather than one request holding the entire
 * recording, so a long meeting doesn't need one monolithic multi-hour
 * inference call with zero partial progress if it fails partway through.
 *
 * Speaker identity across chunks: pyannote's segmentation model only labels
 * speakers LOCALLY within whatever audio it's given, so diarizing each
 * chunk independently would make "speaker 2" in chunk 6 an arbitrary label
 * unrelated to "speaker 2" in chunk 1. transcribe-chunk/route.ts avoids this
 * by extracting (not yet clustering) each chunk's speaker embeddings
 * server-side and clustering every chunk's embeddings TOGETHER, in one pass,
 * only once the last chunk arrives — see runDiarizationCore.ts's
 * extractEmbeddingSpans/clusterEmbeddingSpans split. That's also why chunks
 * are sent sequentially rather than in parallel: the route accumulates
 * state per meeting keyed only by meetingId, with no per-chunk ordering
 * guarantee if multiple requests were in flight at once.
 */

import type { STTSegment, DiarizationSpan } from "./types";
import { encodeFloat32AsInt16Pcm } from "./serverProvider";
import { CHUNK_DURATION_SEC } from "./chunkConstants";
import type { SpeakerCentroid } from "./diarization/speakerClustering";

interface ChunkResponseBody {
  segments?: { start: number; end: number; text: string }[];
  spans?: { startTime: number; duration: number; speakerId: string; speakerIndex: number; recognizedName?: string }[];
  centroids?: { speakerIndex: number; embedding: number[]; recognizedName?: string }[];
}

export async function runChunkedServerTranscription(
  meetingId: string,
  audio: Float32Array,
  sampleRate: number,
  /** Fired after each chunk request completes — lets the caller show real
   *  progress / reset a stall-detection timeout instead of one opaque wait
   *  for the whole meeting. */
  onChunkComplete?: (chunkIndex: number, chunkCount: number) => void,
): Promise<{ segments: STTSegment[]; spans: DiarizationSpan[]; centroids: SpeakerCentroid[] }> {
  const chunkSamples = CHUNK_DURATION_SEC * sampleRate;
  const chunkCount = Math.max(1, Math.ceil(audio.length / chunkSamples));

  let final: ChunkResponseBody = {};
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
          "x-chunk-last": isLast ? "true" : "false",
        },
        // Raw 16-bit PCM per slice, not JSON — same rationale as
        // serverProvider.ts's postAudioForTranscription.
        body: encodeFloat32AsInt16Pcm(slice),
      });
      if (res.status !== 429 || attempt >= 4) break;
      const retryAfterSec = Number(res.headers.get("Retry-After")) || 5;
      await new Promise((resolve) => setTimeout(resolve, Math.min(15, retryAfterSec) * 1000));
    }

    if (!res.ok) {
      throw new Error(
        `Chunked transcribe request failed (chunk ${i + 1}/${chunkCount}): ${res.status} ${res.statusText}`,
      );
    }
    if (isLast) final = (await res.json()) as ChunkResponseBody;
    onChunkComplete?.(i + 1, chunkCount);
  }

  return {
    segments: (final.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text })),
    spans: final.spans ?? [],
    centroids: (final.centroids ?? []).map((c) => ({ ...c, embedding: new Float32Array(c.embedding) })),
  };
}
