/**
 * lib/meeting/stt/localDiarizationProvider.ts
 *
 * REAL local (CPU/GPU WASM, browser) diarization provider. Two ONNX models
 * via @huggingface/transformers, same library localWhisperProvider.ts uses:
 *
 * 1. `onnx-community/pyannote-segmentation-3.0` (AutoModelForAudioFrameClassification)
 *    — voice-activity + LOCAL speaker slots per fixed-size window. Its
 *    output classes are a "powerset" over concurrently-active local
 *    speakers, decoded by diarization/powersetDecode.ts. "Local" because the
 *    model has no notion of identity across windows — window 2's "speaker
 *    1" has no relation to window 1's "speaker 1".
 * 2. `onnx-community/wespeaker-voxceleb-resnet34-LM` (speaker embedding
 *    model) — one embedding per detected local-speaker segment, used to
 *    link identity ACROSS windows via diarization/speakerClustering.ts's
 *    greedy cosine clustering. This is what turns "local" slots into one
 *    stable `speakerIndex` for the whole recording.
 *
 * The actual windowing/decode/cluster loop lives in
 * diarization/runDiarizationCore.ts, shared with serverDiarizationProvider.ts
 * (same models, run server-side via onnxruntime-node instead of the
 * browser's onnxruntime-web) — this class only owns browser-specific model
 * loading (GPU/CPU capability detection + retry).
 */

import type { DiarizationProvider, DiarizationResult } from "./types";
import { detectCapability, reportGpuInitFailure } from "./capabilityDetection";
import {
  runDiarizationWithModels,
  extractEmbeddingSpans,
  powersetClassCountFor,
  type RawEmbeddingSpan,
  type DiarizationModels,
  type FeatureExtractor,
  type FrameClassifier,
  type EmbeddingModel,
} from "./diarization/runDiarizationCore";

const SAMPLE_RATE = 16_000;

export class LocalDiarizationProvider implements DiarizationProvider {
  readonly id = "local-pyannote-wespeaker-transformers-js";

  private models: DiarizationModels | null = null;
  private loadPromise: Promise<void> | null = null;

  /** `onProgress` (0-100) covers both models in sequence (0-50 for
   *  segmentation, 50-100 for embedding) — used by preloadStt.ts's
   *  first-visit loading screen. */
  async load(onProgress?: (pct: number) => void): Promise<void> {
    if (this.models) return;
    if (!this.loadPromise) this.loadPromise = this.doLoad(onProgress);
    return this.loadPromise;
  }

  private async doLoad(onProgress?: (pct: number) => void): Promise<void> {
    const capability = await detectCapability();
    const { AutoModelForAudioFrameClassification, AutoModel, AutoFeatureExtractor, env } = await import(
      "@huggingface/transformers"
    );
    env.allowLocalModels = false;

    const device = capability.tier === "gpu" ? "webgpu" : "wasm";
    // NOT "q8" on CPU — see localWhisperProvider.ts doLoad() doc comment:
    // the pinned onnxruntime-web dev build throws "Missing required scale"
    // for q8's block-wise-quantized MatMul fusion. "fp32" avoids it for both
    // tiers here (these models are small enough that this isn't a real cost).
    const dtype = "fp32";
    // `from_pretrained`'s progress_callback option is typed against the full
    // ProgressInfo union (initiate/download/progress/done/ready/total
    // variants) — cast rather than reproduce that whole union here, since
    // this only ever reads the optional `progress` field.
    const progressFor = (base: number) =>
      onProgress
        ? ((data: { progress?: number }) => {
            if (typeof data.progress === "number") onProgress(base + Math.min(100, Math.max(0, data.progress)) * 0.5);
          })
        : undefined;

    try {
      const segId = "onnx-community/pyannote-segmentation-3.0";
      const segmentationExtractor = (await AutoFeatureExtractor.from_pretrained(segId)) as unknown as FeatureExtractor;
      const segmentationModel = (await AutoModelForAudioFrameClassification.from_pretrained(segId, {
        device,
        dtype,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress_callback: progressFor(0) as any,
      })) as unknown as FrameClassifier;

      const embId = "onnx-community/wespeaker-voxceleb-resnet34-LM";
      const embeddingExtractor = (await AutoFeatureExtractor.from_pretrained(embId)) as unknown as FeatureExtractor;
      const embeddingModel = (await AutoModel.from_pretrained(embId, {
        device,
        dtype,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress_callback: progressFor(50) as any,
      })) as unknown as EmbeddingModel;

      this.models = { segmentationExtractor, segmentationModel, embeddingExtractor, embeddingModel };
    } catch (err) {
      if (capability.tier === "gpu") {
        // Same fallback contract as localWhisperProvider.ts: a GPU load
        // failure downgrades the shared capability cache and retries CPU
        // once, instead of leaving diarization permanently broken this
        // session.
        reportGpuInitFailure(err instanceof Error ? err.message : String(err));
        this.models = null;
        this.loadPromise = null;
        return this.load(onProgress);
      }
      throw err;
    }
  }

  async diarize(audio: Float32Array, sampleRate: number): Promise<DiarizationResult> {
    if (sampleRate !== SAMPLE_RATE) {
      throw new Error(`LocalDiarizationProvider requires ${SAMPLE_RATE}Hz audio, got ${sampleRate}Hz`);
    }
    await this.load();
    if (!this.models) return { spans: [] };
    return runDiarizationWithModels(audio, sampleRate, this.models);
  }

  /** Used by chunkedLocalTranscription.ts to diarize a long meeting in
   *  ~15-minute slices without losing cross-slice speaker identity — see
   *  runDiarizationCore.ts's extractEmbeddingSpans doc comment for why
   *  clustering must be deferred until every slice's spans are collected. */
  async extractEmbeddingSpans(audio: Float32Array, sampleRate: number, timeOffsetSec: number): Promise<RawEmbeddingSpan[]> {
    if (sampleRate !== SAMPLE_RATE) {
      throw new Error(`LocalDiarizationProvider requires ${SAMPLE_RATE}Hz audio, got ${sampleRate}Hz`);
    }
    await this.load();
    if (!this.models) return [];
    return extractEmbeddingSpans(audio, sampleRate, this.models, timeOffsetSec);
  }
}

/** Exposed for a future runtime sanity check (log a warning if the loaded
 *  model's real class count doesn't match this provider's powerset
 *  assumption) — not wired into the hot path today to avoid an extra
 *  model-introspection call on every diarize(). */
export const EXPECTED_POWERSET_CLASS_COUNT = powersetClassCountFor();
