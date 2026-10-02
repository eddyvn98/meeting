"use client";

/**
 * lib/meeting/stt/chunkedLocalTranscription.ts
 *
 * Chunked LOCAL (client-side WASM/WebGPU) transcription — the local-engine
 * counterpart to chunkedServerTranscription.ts, for meetings that should
 * never leave the browser regardless of length. Runs entirely in-process
 * (no network calls: the models already live in this tab), slicing the
 * decoded audio into CHUNK_DURATION_SEC pieces and awaiting them
 * SEQUENTIALLY — one slice's model inference in flight at a time — instead
 * of handing the whole recording to transcriber()/diarize() in one call.
 * That's what actually removes the "long recording risks a crashed/OOM tab"
 * risk providerFactory.ts used to route around by forcing the server tier
 * past a duration threshold: a slow engine chunked into pieces still takes
 * the same total wall-clock time (chunking doesn't speed up WASM inference),
 * but it no longer risks one giant blocking call or a single huge
 * in-flight inference buffer — and `onChunkComplete` gives the caller a
 * steady progress signal instead of one opaque multi-hour wait.
 *
 * Speaker identity across chunks uses the same fix as the server path: each
 * chunk's diarization only EXTRACTS embeddings (LocalDiarizationProvider.
 * extractEmbeddingSpans), never clusters them alone — clustering runs once,
 * over every chunk's embeddings together, after the last chunk (see
 * runDiarizationCore.ts's extractEmbeddingSpans/clusterEmbeddingSpans
 * split). That same final clustering pass also seeds against the
 * company-wide voice library (`seedProfiles`) so a colleague renamed once,
 * in any past meeting, is auto-labeled here too instead of `speaker_N`.
 */

import type { STTProvider, DiarizationProvider, STTSegment, DiarizationSpan } from "./types";
import { clusterEmbeddingSpans, type RawEmbeddingSpan } from "./diarization/runDiarizationCore";
import type { NamedSeedCentroid, SpeakerCentroid } from "./diarization/speakerClustering";
import { LOCAL_DIARIZATION_WINDOW_SEC, LOCAL_STT_WINDOW_SEC } from "./chunkConstants";

export interface ChunkableDiarizationProvider extends DiarizationProvider {
  extractEmbeddingSpans(audio: Float32Array, sampleRate: number, timeOffsetSec: number): Promise<RawEmbeddingSpan[]>;
}

function isChunkable(diarization: DiarizationProvider): diarization is ChunkableDiarizationProvider {
  return typeof (diarization as Partial<ChunkableDiarizationProvider>).extractEmbeddingSpans === "function";
}

/** Fast path used by Processing: return speech text as soon as Whisper has
 * finished. Speaker detection is deliberately not part of this critical
 * path; the caller can enrich the saved transcript in the background. */
export async function runChunkedLocalSTT(
  stt: STTProvider,
  audio: Float32Array,
  sampleRate: number,
  onChunkComplete?: (chunkIndex: number, chunkCount: number) => void,
): Promise<STTSegment[]> {
  const chunkSamples = LOCAL_STT_WINDOW_SEC * sampleRate;
  const chunkCount = Math.max(1, Math.ceil(audio.length / chunkSamples));
  const segments: STTSegment[] = [];

  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSamples;
    const slice = audio.subarray(start, Math.min(start + chunkSamples, audio.length));
    const offsetSec = start / sampleRate;
    const sttResult = await stt.transcribe(slice, sampleRate);
    segments.push(...sttResult.segments.map((s) => ({ start: s.start + offsetSec, end: s.end + offsetSec, text: s.text })));
    onChunkComplete?.(i + 1, chunkCount);
  }

  return segments;
}

/** Background-only local diarization pass. It intentionally has no STT
 * dependency, so the transcript can already be visible while this runs. */
export async function runChunkedLocalDiarization(
  diarization: DiarizationProvider,
  audio: Float32Array,
  sampleRate: number,
  seedProfiles: NamedSeedCentroid[] = [],
): Promise<{ spans: DiarizationSpan[]; centroids: SpeakerCentroid[] }> {
  const chunkSamples = LOCAL_DIARIZATION_WINDOW_SEC * sampleRate;
  const chunkCount = Math.max(1, Math.ceil(audio.length / chunkSamples));
  const chunkable = isChunkable(diarization);

  if (!chunkable) {
    const spans = await diarization.diarize(audio, sampleRate).then((r) => r.spans, () => []);
    return { spans, centroids: [] };
  }

  const rawSpans: RawEmbeddingSpan[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSamples;
    const slice = audio.subarray(start, Math.min(start + chunkSamples, audio.length));
    const offsetSec = start / sampleRate;
    const chunkSpans = await diarization.extractEmbeddingSpans(slice, sampleRate, offsetSec).catch((err) => {
      console.warn(
        "[meeting] Local diarization failed for one background chunk, continuing without its spans:",
        err instanceof Error ? err.message : String(err),
      );
      return [] as RawEmbeddingSpan[];
    });
    rawSpans.push(...chunkSpans);
  }

  const { spans, centroids } = clusterEmbeddingSpans(rawSpans, seedProfiles);
  return { spans, centroids };
}

export async function runChunkedLocalTranscription(
  stt: STTProvider,
  diarization: DiarizationProvider,
  audio: Float32Array,
  sampleRate: number,
  /** Fired after each chunk finishes — lets the caller show real progress
   *  instead of one opaque wait for the whole meeting. */
  onChunkComplete?: (chunkIndex: number, chunkCount: number) => void,
  /** Company-wide voice library (see speakerClustering.ts) — a span
   *  matching a seed is auto-labeled with that colleague's name instead of
   *  an anonymous speaker_N slot. */
  seedProfiles: NamedSeedCentroid[] = [],
): Promise<{ segments: STTSegment[]; spans: DiarizationSpan[]; centroids: SpeakerCentroid[] }> {
  const chunkSamples = LOCAL_STT_WINDOW_SEC * sampleRate;
  const chunkCount = Math.max(1, Math.ceil(audio.length / chunkSamples));
  const chunkable = isChunkable(diarization);

  const segments: STTSegment[] = [];
  const rawSpans: RawEmbeddingSpan[] = [];

  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSamples;
    const slice = audio.subarray(start, Math.min(start + chunkSamples, audio.length));
    const offsetSec = start / sampleRate;

    const [sttResult, chunkSpans] = await Promise.all([
      stt.transcribe(slice, sampleRate),
      // Diarization is best-effort, same contract as the non-chunked path —
      // a failed chunk just contributes no spans instead of aborting the
      // whole meeting's transcript. A diarization provider that can't be
      // chunked (e.g. the server HTTP stub used when local diarization
      // failed to load, see providerFactory.ts's fallback) is diarized
      // whole, once, after this loop instead — see below.
      chunkable
        ? diarization.extractEmbeddingSpans(slice, sampleRate, offsetSec).catch((err) => {
            console.warn(
              "[meeting] Local diarization failed for one chunk, continuing without its spans:",
              err instanceof Error ? err.message : String(err),
            );
            return [] as RawEmbeddingSpan[];
          })
        : Promise.resolve([] as RawEmbeddingSpan[]),
    ]);

    segments.push(...sttResult.segments.map((s) => ({ start: s.start + offsetSec, end: s.end + offsetSec, text: s.text })));
    rawSpans.push(...chunkSpans);
    onChunkComplete?.(i + 1, chunkCount);
  }

  if (chunkable) {
    const { spans, centroids } = clusterEmbeddingSpans(rawSpans, seedProfiles);
    return { segments, spans, centroids };
  }

  const spans = await diarization.diarize(audio, sampleRate).then(
    (r) => r.spans,
    () => [],
  );
  return { segments, spans, centroids: [] };
}
