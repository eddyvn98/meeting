/**
 * lib/meeting/stt/serverDiarizationProviderReal.ts
 *
 * Server-side (Node) counterpart to localDiarizationProvider.ts — same two
 * models (pyannote-segmentation-3.0 + WeSpeaker) and the same shared
 * windowing/clustering loop (diarization/runDiarizationCore.ts), but loaded
 * through @huggingface/transformers' Node backend (onnxruntime-node)
 * instead of the browser's onnxruntime-web.
 *
 * Named `...Real` to stay distinct from serverProvider.ts's
 * `ServerDiarizationProvider`, which is the existing HTTP-client-side class
 * the browser calls; this is the thing running ON the server behind that
 * HTTP call (app/api/meeting/[meetingId]/transcribe/route.ts).
 */

import type { DiarizationProvider, DiarizationResult } from "./types";
import {
  runDiarizationWithModels,
  extractEmbeddingSpans,
  type RawEmbeddingSpan,
  type DiarizationModels,
  type FeatureExtractor,
  type FrameClassifier,
  type EmbeddingModel,
} from "./diarization/runDiarizationCore";

let modelsPromise: Promise<DiarizationModels> | null = null;

async function getModels(): Promise<DiarizationModels> {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const { AutoModelForAudioFrameClassification, AutoModel, AutoFeatureExtractor, env } = await import(
        "@huggingface/transformers"
      );
      env.allowLocalModels = false;
      const dtype = "fp32";

      const segId = "onnx-community/pyannote-segmentation-3.0";
      const segmentationExtractor = (await AutoFeatureExtractor.from_pretrained(segId)) as unknown as FeatureExtractor;
      const segmentationModel = (await AutoModelForAudioFrameClassification.from_pretrained(segId, {
        dtype,
      })) as unknown as FrameClassifier;

      const embId = "onnx-community/wespeaker-voxceleb-resnet34-LM";
      const embeddingExtractor = (await AutoFeatureExtractor.from_pretrained(embId)) as unknown as FeatureExtractor;
      const embeddingModel = (await AutoModel.from_pretrained(embId, { dtype })) as unknown as EmbeddingModel;

      return { segmentationExtractor, segmentationModel, embeddingExtractor, embeddingModel };
    })().catch((err) => {
      // Don't cache a rejected promise — a single transient failure (e.g. a
      // cold-start network blip fetching a model) would otherwise
      // permanently break server-side diarization for every meeting on this
      // process until it restarts.
      modelsPromise = null;
      throw err;
    });
  }
  return modelsPromise;
}

export class ServerDiarizationProviderReal implements DiarizationProvider {
  readonly id = "server-pyannote-wespeaker-transformers-js-node";

  async diarize(audio: Float32Array, sampleRate: number): Promise<DiarizationResult> {
    if (sampleRate !== 16_000) {
      throw new Error(`ServerDiarizationProviderReal requires 16kHz audio, got ${sampleRate}Hz`);
    }
    const models = await getModels();
    return runDiarizationWithModels(audio, sampleRate, models);
  }

  /** Used by transcribe-chunk/route.ts for the long-meeting chunked path —
   *  see runDiarizationCore.ts's extractEmbeddingSpans doc comment for why
   *  clustering must be deferred until every chunk's spans are collected. */
  async extractEmbeddingSpans(audio: Float32Array, sampleRate: number, timeOffsetSec: number): Promise<RawEmbeddingSpan[]> {
    if (sampleRate !== 16_000) {
      throw new Error(`ServerDiarizationProviderReal requires 16kHz audio, got ${sampleRate}Hz`);
    }
    const models = await getModels();
    return extractEmbeddingSpans(audio, sampleRate, models, timeOffsetSec);
  }
}
