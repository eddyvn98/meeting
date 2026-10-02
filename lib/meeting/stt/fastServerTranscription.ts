/**
 * lib/meeting/stt/fastServerTranscription.ts
 *
 * Slices 16kHz mono audio into windows and transcribes them in parallel via
 * OpenRouter MAI-Transcribe 2 on the server. Used for post-recording
 * processing in "fast (paid)" mode. Speaker labels from the API are ignored
 * by the final pass: speakers are detected with our own models instead.
 */

import type { STTSegment, DiarizationSpan } from "./types";
import { encodeFloat32AsInt16Pcm } from "./serverProvider";

const DEFAULT_WINDOW_SEC = 30;
const MAX_CONCURRENT_CHUNKS = 4;
const DEFAULT_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [1_000, 3_000];

export interface FastTranscriptionOptions {
  /** Window length in seconds (default 30). */
  windowSec?: number;
  /** Tries per window before it counts as failed (default 3). */
  attempts?: number;
}

export interface FastTranscriptionResult {
  segments: STTSegment[];
  spans: DiarizationSpan[];
  /** Indices of windows that failed (network error or non-2xx response) and
   *  contributed nothing to `segments`/`spans` — the transcript is missing
   *  audio from these windows even though the overall call succeeded. */
  failedChunkIndices: number[];
  chunkCount: number;
}

export async function runFastServerTranscription(
  meetingId: string,
  audio: Float32Array,
  sampleRate: number,
  onChunkProgress?: (chunkIndex: number, chunkCount: number) => void,
  options: FastTranscriptionOptions = {},
): Promise<FastTranscriptionResult> {
  const { windowSec = DEFAULT_WINDOW_SEC, attempts = DEFAULT_ATTEMPTS } = options;
  const windowSamples = windowSec * sampleRate;
  const chunkCount = Math.max(1, Math.ceil(audio.length / windowSamples));

  const allSegments: STTSegment[] = [];
  const allSpans: DiarizationSpan[] = [];
  const failedChunkIndices: number[] = [];
  let completedCount = 0;

  const indices = Array.from({ length: chunkCount }, (_, i) => i);

  const runWorker = async () => {
    while (indices.length > 0) {
      const i = indices.shift();
      if (i === undefined) break;

      const startSample = i * windowSamples;
      const slice = audio.subarray(startSample, Math.min(startSample + windowSamples, audio.length));
      const offsetSec = startSample / sampleRate;
      const pcmData = encodeFloat32AsInt16Pcm(slice);

      try {
        const data = await requestWindow(meetingId, pcmData, sampleRate, offsetSec, attempts, i);
        if (data.segments) allSegments.push(...data.segments);
        if (data.spans) allSpans.push(...data.spans);
      } catch (chunkErr) {
        console.warn(`[meeting] Fast transcription chunk ${i} failed:`, chunkErr);
        failedChunkIndices.push(i);
      } finally {
        completedCount += 1;
        onChunkProgress?.(completedCount, chunkCount);
      }
    }
  };

  const workers = Array.from({ length: Math.min(MAX_CONCURRENT_CHUNKS, chunkCount) }, () => runWorker());
  await Promise.all(workers);

  if (allSegments.length === 0 && chunkCount > 0) {
    throw new Error("Fast transcription failed for all audio chunks.");
  }
  if (failedChunkIndices.length > 0) {
    console.warn(
      `[meeting] Fast transcription: ${failedChunkIndices.length}/${chunkCount} chunk(s) failed and are missing from the transcript (indices: ${failedChunkIndices.join(", ")}).`,
    );
  }

  allSegments.sort((a, b) => a.start - b.start);
  allSpans.sort((a, b) => a.startTime - b.startTime);

  return { segments: allSegments, spans: allSpans, failedChunkIndices, chunkCount };
}

type WindowResponse = { segments?: STTSegment[]; spans?: DiarizationSpan[] };

/** One window with retries: a transient network or upstream error should not
 *  drop that stretch of the meeting from the transcript. */
async function requestWindow(
  meetingId: string,
  pcmData: ArrayBuffer,
  sampleRate: number,
  offsetSec: number,
  attempts: number,
  windowIndex: number,
): Promise<WindowResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(`/api/meeting/${encodeURIComponent(meetingId)}/transcribe-fast`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-sample-rate": String(sampleRate),
          "x-offset-sec": String(offsetSec),
        },
        body: pcmData,
      });
      if (res.ok) return (await res.json()) as WindowResponse;
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      lastError = new Error(`Window ${windowIndex} failed (${res.status})${body?.error ? `: ${body.error}` : ""}`);
      // Client errors (bad request, too large, not configured) will not succeed on retry.
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastError = err;
    }
    if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]));
  }
  throw lastError;
}
