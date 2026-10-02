"use client";

/**
 * lib/meeting/processing/runLocalMeetingProcessing.ts
 *
 * Drives the REAL transcription attempt after a meeting is finalized (called
 * from the Processing screen and the recording screen through
 * useMeetingProcessingRun.ts): fetch the recorded audio, decode + resample
 * it, then run the final pass on the engine chosen in processingEngine.ts:
 * - "api": the paid API returns the text; speakers are then detected with our
 *   own models (server on phones, in-browser on desktop) so they match the
 *   company voice library.
 * - "server": our server runs Whisper + speaker detection.
 * - "auto": the free in-browser model (chunkedLocalTranscription.ts), with a
 *   whole-meeting retry on the server tier if it fails mid-run.
 *
 * Each transcript segment is tagged with a speakerIndex by time overlap
 * against the diarization spans (stt/diarization/mergeSpeakers.ts), and the
 * result is persisted via POST /api/meeting/[meetingId]/transcript.
 *
 * This never throws: it resolves an outcome, and for "api" / "server" the
 * caller asks the user before trying anything else (a different engine may
 * cost money), instead of silently switching engines.
 */

import { getSTTProviders, getDiarizationProvider } from "@/lib/meeting/stt/providerFactory";
import { decodeAudioTo16kMono } from "@/lib/meeting/stt/audioDecode";
import { assignSpeakerIndexes } from "@/lib/meeting/stt/diarization/mergeSpeakers";
import { mergeUtterances } from "@/lib/meeting/stt/mergeUtterances";
import { runChunkedLocalDiarization, runChunkedLocalSTT } from "@/lib/meeting/stt/chunkedLocalTranscription";
import { runChunkedServerTranscription } from "@/lib/meeting/stt/chunkedServerTranscription";
import { runChunkedServerDiarization } from "@/lib/meeting/stt/chunkedServerDiarization";
import { isMobileDevice } from "@/lib/meeting/stt/transcriptionMode";
import { runFastServerTranscription } from "@/lib/meeting/stt/fastServerTranscription";
import type { ProcessingEngine } from "./processingEngine";
import type { STTSegment, DiarizationSpan } from "@/lib/meeting/stt/types";
import type { NamedSeedCentroid, SpeakerCentroid } from "@/lib/meeting/stt/diarization/speakerClustering";

interface SpeakerTaggedSegment extends STTSegment {
  speakerIndex: number;
}

export type ProcessingOutcome = { ok: true } | { ok: false; reason: string };

const failed = (reason: string): ProcessingOutcome => ({ ok: false, reason });

/** Names the step that failed, so the message the user sees is not a bare
 *  browser error like "Failed to fetch". */
async function inStep<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw new Error(`${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Retries a network step a few times: a dropped connection or a server
 *  restarting mid-request should not fail a whole processing run. */
async function withRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await run();
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, 1_000 * 2 ** attempt));
    }
  }
  throw lastError;
}

/** The paid API gets larger windows for the final pass than the live preview:
 *  the API labels speakers per request, so fewer windows means fewer places
 *  where a speaker's label can change. */
const FINAL_API_WINDOW_SEC = 120;

export async function runLocalMeetingProcessing(
  meetingId: string,
  /** Fired as soon as the real audio duration is known (right after decode,
   *  well before transcription starts) — the caller uses this to arm its
   *  stall-detection timeout ahead of the first chunk finishing. */
  onDurationKnown?: (durationSec: number) => void,
  /** Fired after each chunk finishes, whichever engine is running — the
   *  caller resets its give-up timer on every call instead of computing one
   *  static budget for the whole meeting upfront, so an arbitrarily long
   *  meeting keeps going as long as it keeps making steady progress. */
  onChunkProgress?: (chunkIndex: number, chunkCount: number) => void,
  /** Which engine does the final pass (see processingEngine.ts). "api" and
   *  "server" never fall back to another engine on their own: a failure is
   *  returned so the UI can ask the user what to do next. */
  engine: ProcessingEngine = "auto",
  /** Whisper language code (lib/meeting/sttLanguages.ts) — the meeting's
   *  stored `sttLanguage`. */
  sttLanguage = "vi",
): Promise<ProcessingOutcome> {
  try {
    const blob = await inStep("Couldn't download the recording", () =>
      withRetry(async () => {
        const audioRes = await fetch(`/api/meeting/${meetingId}/audio`, { cache: "no-store" });
        if (!audioRes.ok) throw new Error(`the server answered ${audioRes.status}`);
        return audioRes.blob();
      }),
    );
    if (blob.size === 0) return failed("The recorded audio is empty.");

    const { audio, sampleRate } = await inStep("Couldn't read the recording's audio", () => decodeAudioTo16kMono(blob));
    if (audio.length === 0) return failed("The recorded audio could not be decoded.");
    onDurationKnown?.(audio.length / sampleRate);

    if (engine === "api") return await processWithApi(meetingId, audio, sampleRate, onChunkProgress);
    if (engine === "server") return await processWithServer(meetingId, audio, sampleRate, onChunkProgress);
    return await processInBrowser(meetingId, audio, sampleRate, onChunkProgress, sttLanguage);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[meeting] Processing failed (${engine}):`, reason);
    return failed(reason);
  }
}

/** Paid API for the TEXT. Speakers are detected with our own models: the API
 *  returns no voice embeddings, so its labels could not be matched to the
 *  company voice library or to speakers named in earlier meetings. */
async function processWithApi(
  meetingId: string,
  audio: Float32Array,
  sampleRate: number,
  onChunkProgress?: (chunkIndex: number, chunkCount: number) => void,
): Promise<ProcessingOutcome> {
  const result = await inStep("The paid API request failed", () =>
    runFastServerTranscription(meetingId, audio, sampleRate, onChunkProgress, { windowSec: FINAL_API_WINDOW_SEC }),
  );
  if (result.failedChunkIndices.length > 0) {
    return failed(`${result.failedChunkIndices.length} of ${result.chunkCount} parts of the recording could not be transcribed.`);
  }
  if (result.segments.length === 0) return failed("No speech was detected in the recording.");

  // Show the text right away; speaker labels are filled in afterwards.
  const initialTranscript = result.segments.map((s) => ({ ...s, speakerIndex: 0 }));
  if (!(await saveTranscript(meetingId, initialTranscript, [], true))) return failed("The transcript could not be saved.");

  // Phones detect speakers on our server (heavy models stay off the device);
  // desktops use the in-browser models, like the free path.
  const diarize = isMobileDevice()
    ? () => runChunkedServerDiarization(meetingId, audio, sampleRate)
    : async () => runChunkedLocalDiarization(await getDiarizationProvider(meetingId), audio, sampleRate, await loadVoiceProfileSeeds());
  void enrichTranscriptWithDiarization(meetingId, result.segments, diarize);
  return { ok: true };
}

/** Our server: Whisper plus server-side speaker detection. */
async function processWithServer(
  meetingId: string,
  audio: Float32Array,
  sampleRate: number,
  onChunkProgress?: (chunkIndex: number, chunkCount: number) => void,
): Promise<ProcessingOutcome> {
  // Same two-phase path as browser/API processing: get durable text first,
  // start Overview generation immediately, then detect speakers separately.
  const chunked = await runChunkedServerTranscription(
    meetingId,
    audio,
    sampleRate,
    onChunkProgress,
    { textOnly: true },
  );
  if (chunked.segments.length === 0) return failed("No speech was detected in the recording.");

  const initialTranscript = chunked.segments.map((s) => ({ ...s, speakerIndex: 0 }));
  if (!(await saveTranscript(meetingId, initialTranscript, [], true))) {
    return failed("The transcript could not be saved.");
  }

  void enrichTranscriptWithDiarization(meetingId, chunked.segments, () =>
    runChunkedServerDiarization(meetingId, audio, sampleRate),
  );
  return { ok: true };
}

/** Free desktop path: in-browser model, retrying the whole meeting on the
 *  server tier if the local engine fails mid-run. */
async function processInBrowser(
  meetingId: string,
  audio: Float32Array,
  sampleRate: number,
  onChunkProgress: ((chunkIndex: number, chunkCount: number) => void) | undefined,
  sttLanguage: string,
): Promise<ProcessingOutcome> {
  const seedProfiles = await loadVoiceProfileSeeds();
  const { stt, diarization, tier } = await getSTTProviders({ meetingId, language: sttLanguage });
  if (tier === "server") return processWithServer(meetingId, audio, sampleRate, onChunkProgress);

  try {
    // Whisper is the user-visible critical path. Save it immediately so the
    // result page can show the full text while speaker detection and summary
    // generation continue in the background.
    const sttSegments = await runChunkedLocalSTT(stt, audio, sampleRate, onChunkProgress);
    if (sttSegments.length === 0) return failed("No speech was detected in the recording.");
    const initialTranscript = sttSegments.map((s) => ({ ...s, speakerIndex: 0 }));
    if (!(await saveTranscript(meetingId, initialTranscript, [], true))) return failed("The transcript could not be saved.");

    void enrichTranscriptWithDiarization(meetingId, sttSegments, () =>
      runChunkedLocalDiarization(diarization, audio, sampleRate, seedProfiles),
    );
    return { ok: true };
  } catch (err) {
    // A chunk's stt.transcribe() throwing mid-meeting means the local WASM
    // engine loaded fine but failed during inference — getSTTProviders() only
    // catches a *load* failure. Retry the whole meeting once on the server
    // rather than discarding whatever chunks already succeeded silently.
    console.warn("[meeting] Local chunked STT failed, retrying whole meeting via server tier:", err instanceof Error ? err.message : String(err));
    return processWithServer(meetingId, audio, sampleRate, onChunkProgress);
  }
}

async function saveTagged(
  meetingId: string,
  sttSegments: STTSegment[],
  spans: DiarizationSpan[],
  centroids: SpeakerCentroid[],
): Promise<ProcessingOutcome> {
  if (sttSegments.length === 0) return failed("No speech was detected in the recording.");
  const speakerIndexes = assignSpeakerIndexes(
    sttSegments.map((s) => ({ start: s.start, end: s.end })),
    spans.map((s) => ({ start: s.startTime, end: s.startTime + s.duration, speakerIndex: s.speakerIndex })),
  );
  const tagged: SpeakerTaggedSegment[] = sttSegments.map((s, i) => ({ ...s, speakerIndex: speakerIndexes[i] }));
  const saved = await saveTranscript(meetingId, mergeUtterances(tagged), centroids);
  return saved ? { ok: true } : failed("The transcript could not be saved.");
}

async function saveTranscript(
  meetingId: string,
  segments: SpeakerTaggedSegment[],
  centroids: SpeakerCentroid[],
  isPartial = false,
  isDiarizationUpdate = false,
): Promise<boolean> {
  const body = JSON.stringify({
    segments,
    isPartial,
    isDiarizationUpdate,
    // Persisted onto Speaker.embeddingJson (transcript/route.ts) so a later
    // rename can enroll this voice into the company-wide library — see
    // voiceLibrary.ts. Also carries `recognizedName` when this speaker
    // already matched a past enrollment, so the route can auto-create the
    // SpeakerMapping instead of leaving `speaker_N`.
    speakerCentroids: centroids.map((c) => ({
      speakerIndex: c.speakerIndex,
      embedding: Array.from(c.embedding),
      recognizedName: c.recognizedName,
    })),
  });
  return inStep("Couldn't save the transcript", () =>
    withRetry(async () => {
      const res = await fetch(`/api/meeting/${meetingId}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      // A server answer is final; only a dropped connection is retried.
      return res.ok;
    }),
  );
}

/** Completes speaker labels after the text is already visible. A failure in
 * this optional phase must not hide or replace the usable transcript. */
async function enrichTranscriptWithDiarization(
  meetingId: string,
  sttSegments: STTSegment[],
  diarize: () => Promise<{ spans: DiarizationSpan[]; centroids: SpeakerCentroid[] }>,
): Promise<void> {
  try {
    const { spans, centroids } = await diarize();
    const speakerIndexes = assignSpeakerIndexes(
      sttSegments.map((s) => ({ start: s.start, end: s.end })),
      spans.map((s) => ({ start: s.startTime, end: s.startTime + s.duration, speakerIndex: s.speakerIndex })),
    );
    const tagged: SpeakerTaggedSegment[] = sttSegments.map((s, i) => ({ ...s, speakerIndex: speakerIndexes[i] }));
    const utterances = mergeUtterances(tagged);
    if (utterances.length > 0) await saveTranscript(meetingId, utterances, centroids, false, true);
  } catch (err) {
    console.warn("[meeting] Background diarization failed; keeping the initial transcript:", err instanceof Error ? err.message : String(err));
  }
}

/** Fetches the company-wide voice library (GET /api/meeting/voice-profiles)
 *  so diarization clustering can auto-label a colleague enrolled from a
 *  past meeting instead of an anonymous `speaker_N` — see
 *  speakerClustering.ts's `seedProfiles`. Best-effort: a fetch failure just
 *  means this meeting gets no seeds, same as if the library were empty. */
async function loadVoiceProfileSeeds(): Promise<NamedSeedCentroid[]> {
  try {
    const res = await fetch("/api/meeting/voice-profiles", { cache: "no-store" });
    if (!res.ok) return [];
    const rows = (await res.json()) as { displayName: string; embedding: number[] }[];
    return rows.map((r) => ({ displayName: r.displayName, embedding: new Float32Array(r.embedding) }));
  } catch {
    return [];
  }
}
