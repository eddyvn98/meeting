/**
 * lib/meeting/stt/chunkedServerDiarization.ts
 *
 * Speaker detection on our server, without transcription: used after the paid
 * API produced the text (its speaker labels carry no voice embeddings, so they
 * can't be matched to the company voice library). Slices the audio into
 * CHUNK_DURATION_SEC pieces and POSTs them sequentially to
 * /api/meeting/[meetingId]/diarize-chunk; the last response holds the
 * clustered, voice-library-labeled result for the whole meeting.
 */

import type { DiarizationSpan } from "./types";
import { encodeFloat32AsInt16Pcm } from "./serverProvider";
import { CHUNK_DURATION_SEC } from "./chunkConstants";
import type { SpeakerCentroid } from "./diarization/speakerClustering";

interface DiarizeResponseBody {
  spans?: DiarizationSpan[];
  centroids?: { speakerIndex: number; embedding: number[]; recognizedName?: string }[];
}

export async function runChunkedServerDiarization(
  meetingId: string,
  audio: Float32Array,
  sampleRate: number,
): Promise<{ spans: DiarizationSpan[]; centroids: SpeakerCentroid[] }> {
  const chunkSamples = CHUNK_DURATION_SEC * sampleRate;
  const chunkCount = Math.max(1, Math.ceil(audio.length / chunkSamples));

  let final: DiarizeResponseBody = {};
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
          "x-chunk-last": isLast ? "true" : "false",
        },
        body: encodeFloat32AsInt16Pcm(slice),
      });
      if (res.status !== 429 || attempt >= 4) break;
      const retryAfterSec = Number(res.headers.get("Retry-After")) || 5;
      await new Promise((resolve) => setTimeout(resolve, Math.min(15, retryAfterSec) * 1000));
    }
    if (!res.ok) throw new Error(`Speaker detection request failed (chunk ${i + 1}/${chunkCount}): ${res.status}`);
    if (isLast) final = (await res.json()) as DiarizeResponseBody;
  }

  return {
    spans: final.spans ?? [],
    centroids: (final.centroids ?? []).map((c) => ({ ...c, embedding: new Float32Array(c.embedding) })),
  };
}
