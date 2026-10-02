/**
 * lib/meeting/stt/diarization/runDiarizationCore.ts
 *
 * Model-agnostic diarization loop, extracted from localDiarizationProvider.ts
 * so a second provider (serverDiarizationProvider.ts, running the same
 * pyannote+WeSpeaker models via onnxruntime-node instead of onnxruntime-web)
 * can reuse the exact same windowing/decode/cluster logic instead of
 * duplicating it. Callers own model loading + device/dtype choice; this file
 * only owns "given loaded models, turn audio into DiarizationSpan[]".
 */

import type { DiarizationResult, DiarizationSpan } from "../types";
import { decodePowersetId, powersetClassCount } from "./powersetDecode";
import { clusterSpansBySpeaker, type EmbeddingSpan, type NamedSeedCentroid, type SpeakerCentroid } from "./speakerClustering";

const WINDOW_SECONDS = 20;
const MIN_SEGMENT_SECONDS = 0.3;
// WeSpeaker-style embeddings are only reliably discriminative from at least
// ~1.5s of speech — MIN_SEGMENT_SECONDS (0.3s) is fine for deciding a
// segment is worth transcribing/timing, but feeding a model that short
// straight into the embedding model produces near-random vectors, which is
// what was actually causing a real 2-speaker recording (clean broadcast
// audio, not noisy meeting audio) to fragment into a dozen spurious
// "speakers" downstream — no amount of clustering-threshold tuning fixes a
// bad embedding. `embeddingSliceBounds` below extends the audio SLICE FED
// TO THE EMBEDDING MODEL ONLY (never the span's own reported start/duration,
// which stays exactly what segmentation detected) by borrowing context from
// either side, clamped to the current 20s window.
const EMBEDDING_MIN_SECONDS = 1.5;
const NUM_LOCAL_SPEAKERS = 3;
const MAX_CONCURRENT_SPEAKERS = 2;

/** Widens [segStart, segEnd) symmetrically up to EMBEDDING_MIN_SECONDS,
 *  clamped to [0, windowDurationSec] — exported for unit testing the
 *  clamping math without needing real audio/models. */
export function embeddingSliceBounds(
  segStart: number,
  segEnd: number,
  windowDurationSec: number,
): [number, number] {
  const need = EMBEDDING_MIN_SECONDS - (segEnd - segStart);
  if (need <= 0) return [segStart, segEnd];

  let start = segStart - need / 2;
  let end = segEnd + need / 2;
  if (start < 0) {
    end += -start;
    start = 0;
  }
  if (end > windowDurationSec) {
    start -= end - windowDurationSec;
    end = windowDurationSec;
  }
  return [Math.max(0, start), Math.min(windowDurationSec, end)];
}

interface RawLocalSegment {
  id: number;
  start: number;
  end: number;
}

// Minimal shape used from @huggingface/transformers — kept narrow instead of
// importing the library's own (much larger) types.
export interface FeatureExtractorOutput {
  input_values?: unknown;
  [key: string]: unknown;
}
export type FeatureExtractor = (audio: Float32Array) => Promise<FeatureExtractorOutput>;
export type FrameClassifier = (inputs: FeatureExtractorOutput) => Promise<{ logits: { tolist(): number[][][] } }>;
// The wespeaker-voxceleb-resnet34-LM checkpoint isn't in transformers.js's
// architecture map (confirmed live: "Falling back to EncoderOnly (single
// model.onnx file)" warning), so its output isn't a named `embeddings`
// field the way a purpose-built embedding pipeline would return — the
// generic encoder wrapper names its one output tensor `last_hidden_state`
// (verified directly against the loaded model), which is the actual
// speaker-embedding vector here despite the generic name.
export type EmbeddingModel = (inputs: FeatureExtractorOutput) => Promise<{ last_hidden_state: { tolist(): number[][] } }>;

export interface DiarizationModels {
  segmentationExtractor: FeatureExtractor;
  segmentationModel: FrameClassifier;
  embeddingExtractor: FeatureExtractor;
  embeddingModel: EmbeddingModel;
}

/** Raw per-window output before cross-window speaker identity is resolved —
 *  see extractEmbeddingSpans below. `localId` is the model's own
 *  WITHIN-THIS-CALL powerset speaker slot, kept only for the `speakerId`
 *  debug label; it is NOT a stable identity across separate calls (that's
 *  exactly the problem clustering solves). */
export interface RawEmbeddingSpan {
  span: EmbeddingSpan;
  localId: number;
}

/** Runs the fixed-window segmentation + embedding extraction pipeline
 *  against already-loaded models, WITHOUT clustering spans into a stable
 *  speakerIndex yet — see clusterEmbeddingSpans. Splitting this out lets a
 *  long meeting be diarized in several sequential audio slices (each with
 *  its own call here) while still assigning ONE globally-consistent set of
 *  speaker identities, by clustering every slice's spans together in a
 *  single final pass instead of separately per slice (see
 *  chunkedServerTranscription.ts for the orchestration that does this).
 *
 *  `timeOffsetSec` shifts every returned span's `startTime` so spans from
 *  multiple slices of the same recording sort and cluster correctly by
 *  absolute meeting time — pass the slice's start time within the full
 *  recording (0 for a non-chunked, whole-meeting call). `sampleRate` must be
 *  16kHz — callers check that themselves so the error message can name
 *  their own class. */
export async function extractEmbeddingSpans(
  audio: Float32Array,
  sampleRate: number,
  models: DiarizationModels,
  timeOffsetSec = 0,
): Promise<RawEmbeddingSpan[]> {
  const windowSamples = WINDOW_SECONDS * sampleRate;
  const raw: RawEmbeddingSpan[] = [];

  for (let offset = 0; offset < audio.length; offset += windowSamples) {
    const window = audio.subarray(offset, Math.min(offset + windowSamples, audio.length));
    if (window.length < sampleRate * MIN_SEGMENT_SECONDS) continue;

    const localSegments = await detectLocalSegments(window, sampleRate, models);
    for (const seg of localSegments) {
      const activeSpeakers = decodePowersetId(seg.id, NUM_LOCAL_SPEAKERS, MAX_CONCURRENT_SPEAKERS);
      if (activeSpeakers.length === 0) continue;
      const duration = seg.end - seg.start;
      if (duration < MIN_SEGMENT_SECONDS) continue;

      const [embStart, embEnd] = embeddingSliceBounds(seg.start, seg.end, window.length / sampleRate);
      const embedding = await extractEmbedding(
        window.subarray(Math.round(embStart * sampleRate), Math.round(embEnd * sampleRate)),
        models,
      );
      if (!embedding) continue;

      raw.push({
        span: {
          embedding,
          startTime: timeOffsetSec + offset / sampleRate + seg.start,
          duration,
        },
        // First active speaker only — overlapping speech collapses to it
        // (see module doc comment on the original provider for rationale).
        localId: activeSpeakers[0],
      });
    }
  }

  return raw;
}

export interface ClusterEmbeddingSpansResult {
  spans: DiarizationSpan[];
  /** One centroid per speakerIndex — see speakerClustering.ts's
   *  SpeakerCentroid doc comment for why this is returned alongside spans:
   *  transcript/route.ts persists it onto Speaker.embeddingJson so a LATER
   *  rename can enroll this voice into the company-wide MeetingVoiceProfile
   *  library even though the raw per-span embeddings are never kept. */
  centroids: SpeakerCentroid[];
}

/** Final step: assigns one stable speakerIndex per span by clustering
 *  embeddings across ALL of them together (see speakerClustering.ts) —
 *  call this once over every slice's combined extractEmbeddingSpans()
 *  output, never per slice, or cross-slice speaker identity breaks.
 *  `seedProfiles` (optional) is the company-wide voice library — a span
 *  matching a seed is auto-labeled with that colleague's name instead of an
 *  anonymous `speaker_N` slot (see speakerClustering.ts). */
export function clusterEmbeddingSpans(
  raw: RawEmbeddingSpan[],
  seedProfiles: NamedSeedCentroid[] = [],
): ClusterEmbeddingSpansResult {
  if (raw.length === 0) return { spans: [], centroids: [] };

  const clustered = clusterSpansBySpeaker(raw.map((r) => r.span), seedProfiles);
  const spans: DiarizationSpan[] = clustered.spans.map((span, i) => ({
    startTime: span.startTime,
    duration: span.duration,
    speakerId: `local-${raw[i].localId}`,
    speakerIndex: span.speakerIndex,
    recognizedName: span.recognizedName,
  }));
  return { spans, centroids: clustered.centroids };
}

/** Runs the fixed-window segmentation + embedding + clustering pipeline
 *  against already-loaded models in one shot — a thin wrapper over
 *  extractEmbeddingSpans + clusterEmbeddingSpans for the common (whole
 *  recording in one call) case. `sampleRate` must be 16kHz — callers check
 *  that themselves so the error message can name their own class. */
export async function runDiarizationWithModels(
  audio: Float32Array,
  sampleRate: number,
  models: DiarizationModels,
): Promise<DiarizationResult> {
  const raw = await extractEmbeddingSpans(audio, sampleRate, models);
  return clusterEmbeddingSpans(raw);
}

async function detectLocalSegments(
  window: Float32Array,
  sampleRate: number,
  models: DiarizationModels,
): Promise<RawLocalSegment[]> {
  const inputs = await models.segmentationExtractor(window);
  const { logits } = await models.segmentationModel(inputs);

  // Re-implements transformers.js's own
  // `PyAnnoteFeatureExtractor.post_process_speaker_diarization` frame ->
  // segment collapsing (argmax per frame, merge consecutive equal ids)
  // directly against the raw logits, since that helper isn't exposed on
  // AutoModelForAudioFrameClassification's return value here.
  const [scores] = logits.tolist();
  const framesPerSecond = scores.length / (window.length / sampleRate);
  const segments: RawLocalSegment[] = [];
  let currentId = -1;
  for (let i = 0; i < scores.length; i++) {
    const id = argmax(scores[i]);
    if (id !== currentId) {
      currentId = id;
      segments.push({ id, start: i / framesPerSecond, end: (i + 1) / framesPerSecond });
    } else {
      segments.at(-1)!.end = (i + 1) / framesPerSecond;
    }
  }
  return segments;
}

async function extractEmbedding(
  audioSlice: Float32Array,
  models: DiarizationModels,
): Promise<Float32Array | null> {
  if (audioSlice.length === 0) return null;
  const inputs = await models.embeddingExtractor(audioSlice);
  const { last_hidden_state } = await models.embeddingModel(inputs);
  const [vector] = last_hidden_state.tolist();
  return vector ? new Float32Array(vector) : null;
}

/** Powerset class count implied by this module's fixed speaker-slot
 *  assumption — exposed so a caller can sanity-check a loaded model's real
 *  output width matches (see localDiarizationProvider.ts's re-export). */
export function powersetClassCountFor(): number {
  return powersetClassCount(NUM_LOCAL_SPEAKERS, MAX_CONCURRENT_SPEAKERS);
}

function argmax(values: number[]): number {
  let bestIndex = 0;
  let bestValue = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > bestValue) {
      bestValue = values[i];
      bestIndex = i;
    }
  }
  return bestIndex;
}
