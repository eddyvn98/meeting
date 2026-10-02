/**
 * lib/meeting/stt/localWhisperProvider.ts
 *
 * Browser-local STT provider. GPU-capable browsers keep using Transformers.js
 * + WebGPU. CPU browsers use whisper.cpp WASM with a q5_1 model: this avoids
 * the ONNX MatMulNBits/q8 incompatibility and is materially lighter for the
 * short live-preview windows used by the recorder.
 *
 * The model weights are fetched from the Hugging Face Hub on first use and
 * cached by the browser (IndexedDB) — nothing is bundled
 * in this repo, matching the spec's "fetch model + WASM at load time"
 * design (see providerFactory.ts doc comment).
 */

import type { STTProvider, STTResult, STTSegment } from "./types";
import { detectCapability, reportGpuInitFailure } from "./capabilityDetection";
import { isMeaningfulSttText } from "./filterHallucinations";
import { detectWhisperLanguage } from "./detectWhisperLanguage";
import { AUTO_STT_LANG } from "../sttLanguages";

export interface LocalWhisperProviderOptions {
  /** e.g. "small", "base.en" — mapped to the matching Whisper model.
   *  Defaults to "small": the smallest multilingual Whisper size, chosen
   *  over the .en-only tiers so meetings in languages other than English
   *  transcribe correctly; still light enough (~180MB q5_1) for in-browser
   *  WASM/WebGPU inference. */
  modelName?: string;
  /** Whisper language code (e.g. "vi", "en"). Whisper's own auto-detect is
   *  unreliable on the short (~10s) live-preview windows, and Transformers.js
   *  silently defaults to English when no language is given at all (it does
   *  NOT auto-detect) — so this is a fixed setting rather than left to guess
   *  per chunk. Defaults to "vi" for this deployment's meetings. */
  language?: string;
}

type WhisperOutput = { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] };
type Transcriber = (
  audio: Float32Array,
  options: { return_timestamps: boolean; chunk_length_s: number; language?: string },
) => Promise<WhisperOutput>;

export class LocalWhisperProvider implements STTProvider {
  readonly id: string;
  private readonly modelName: string;
  /** Mutable — the background warm-up (preloadStt.ts) can load the model before the user has
   *  necessarily picked a language on MeetingHome.tsx, so setLanguage()
   *  lets the caller update it later on the same (already-loaded) instance
   *  instead of forcing a reload. */
  private language: string;
  private transcriber: Transcriber | null = null;
  /** The raw Transformers.js pipeline object (webgpu/wasm-transformers
   *  branches only — null when whisper.cpp is loaded instead), kept around
   *  so "auto" language can run detectWhisperLanguage()'s low-level
   *  model.generate() call against it. whisper.cpp needs no such reference:
   *  it accepts "auto" directly and detects natively. */
  private pipe: Parameters<typeof detectWhisperLanguage>[0] | null = null;
  private loadPromise: Promise<void> | null = null;
  private runtimeInfo: { device: "webgpu" | "wasm"; dtype: "q5_1" | "q8" | "int8" | "uint8" | "fp32"; logicalCores: number; crossOriginIsolated: boolean } | null = null;

  constructor(options: LocalWhisperProviderOptions = {}) {
    this.modelName = options.modelName ?? "small";
    this.language = options.language ?? "vi";
    this.id = `local-whisper-cpp-wasm:${this.modelName}`;
  }

  /** Downloads + initializes the model, choosing GPU (WebGPU) or CPU (WASM)
   *  based on capability detection. Idempotent and concurrency-safe — safe
   *  to call before every `transcribe()`, only does real work once.
   *  `onProgress` (0-100) is reported from transformers.js's own
   *  `progress_callback` — used by preloadStt.ts to drive the first-visit
   *  loading screen's progress bar. */
  async load(onProgress?: (pct: number) => void): Promise<void> {
    if (this.transcriber) return;
    if (!this.loadPromise) {
      // Forget a failed load so the next call tries again: a download that
      // failed once (network blip, Hub hiccup) must not keep every later
      // chunk of this session failing with the same cached error.
      this.loadPromise = this.doLoad(onProgress).catch((err) => {
        this.loadPromise = null;
        throw err;
      });
    }
    return this.loadPromise;
  }

  private async doLoad(onProgress?: (pct: number) => void): Promise<void> {
    const capability = await detectCapability();
    const { pipeline, env } = await import("@huggingface/transformers");
    // Only the HF Hub CDN is a valid model source here — never a
    // same-origin /models path we don't ship.
    env.allowLocalModels = false;

    // onnx-community publishes the complete int8 encoder/decoder pair. The
    // older Xenova repo is missing encoder_model_int8.onnx, so int8 cannot be
    // selected there even though the decoder files exist.
    const modelId = `onnx-community/whisper-${this.modelName}`;
    const progress_callback = onProgress
      ? (data: { status?: string; progress?: number }) => {
          if (typeof data.progress === "number") onProgress(Math.min(100, Math.max(0, data.progress)));
        }
      : undefined;

    // ONNX Runtime defaults to one WASM thread unless the document is
    // cross-origin isolated. Once COOP/COEP is active for /meeting, use all
    // logical CPUs advertised by the browser; this is the main CPU-only speed
    // lever available to the browser runtime. ORT still safely falls back to
    // one thread on browsers that cannot provide SharedArrayBuffer.
    const logicalCores = typeof navigator !== "undefined" && navigator.hardwareConcurrency > 0 ? navigator.hardwareConcurrency : 1;
    const isolated = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
    const onnxWasm = (env.backends.onnx as { wasm?: { numThreads?: number } } | undefined)?.wasm;
    if (onnxWasm) {
      onnxWasm.numThreads = logicalCores;
      console.info("[meeting] Whisper WASM thread budget", {
        logicalCores,
        crossOriginIsolated: typeof crossOriginIsolated !== "undefined" && crossOriginIsolated,
      });
    }

    const loadModel = async (device: "webgpu" | "wasm", dtype: "q8" | "int8" | "uint8" | "fp32") => {
      const pipe = await pipeline("automatic-speech-recognition", modelId, {
        dtype,
        device,
        progress_callback,
      });
      this.pipe = pipe as unknown as Parameters<typeof detectWhisperLanguage>[0];
      return pipe as unknown as Transcriber;
    };

    const loadWhisperCpp = async () => {
      const { ModelManager, WhisperWasmService } = await import("@timur00kh/whisper.wasm");
      const service = new WhisperWasmService({ logLevel: 0 });
      if (!(await service.checkWasmSupport())) throw new Error("whisper.cpp WASM is not supported by this browser");

      const cppModel =
        this.modelName === "tiny"
          ? "tiny-q5_1"
          : this.modelName === "base"
            ? "base-q5_1"
            : this.modelName === "small"
              ? "small-q5_1"
              : this.modelName === "base.en"
                ? "base.en-q5_1"
                : this.modelName === "small.en"
                  ? "small.en-q5_1"
                  : "tiny.en-q5_1";
      const modelManager = new ModelManager({ logLevel: 0 });
      const cppProgress = onProgress
        ? (progress: number) => onProgress(Math.round(Math.min(1, Math.max(0, progress)) * 100))
        : undefined;
      const model = await modelManager.loadModel(cppModel, true, cppProgress);
      await service.initModel(model);

      this.pipe = null;
      this.transcriber = async (audio) => {
        // Read this.language fresh on every call (not a value captured once
        // at load time) so setLanguage() after preload actually takes
        // effect on subsequent transcribe() calls. whisper.cpp accepts
        // "auto" natively (real native langid), unlike the Transformers.js
        // branches below which need detectWhisperLanguage() instead.
        const language = this.modelName.endsWith(".en") ? "en" : this.language;
        const result = await service.transcribe(audio, undefined, {
          language,
          threads: logicalCores,
          translate: false,
        });
        return {
          text: result.segments.map((segment) => segment.text).join(" "),
          chunks: result.segments.map((segment) => ({
            text: segment.text,
            timestamp: [segment.timeStart / 1000, segment.timeEnd / 1000] as [number, number],
          })),
        };
      };
      this.runtimeInfo = { device: "wasm", dtype: "q5_1", logicalCores, crossOriginIsolated: isolated };
      console.info("[meeting] Whisper loaded", { engine: "whisper.cpp", device: "wasm", dtype: "q5_1", threads: logicalCores });
    };

    if (capability.tier === "gpu") {
      try {
        // q8 WebGPU was tested on the current Chrome/ORT runtime and did not
        // complete inference reliably. fp32 WebGPU is the faster stable path
        // when a real GPU is available; whisper.cpp remains the first CPU path below.
        this.transcriber = await loadModel("webgpu", "fp32");
        this.runtimeInfo = { device: "webgpu", dtype: "fp32", logicalCores, crossOriginIsolated: isolated };
        console.info("[meeting] Whisper loaded", { device: "webgpu", dtype: "fp32" });
        return;
      } catch (err) {
        // Per capabilityDetection.ts: requestAdapter() success never
        // guarantees a model actually initializes on that adapter. Report
        // the failure so future selections (this session) skip GPU, then
        // fall through to the CPU path below rather than surfacing an error.
        reportGpuInitFailure(err instanceof Error ? err.message : String(err));
      }
    }

    try {
      await loadWhisperCpp();
      return;
    } catch (err) {
      console.warn("[meeting] whisper.cpp WASM load failed, falling back to Transformers.js WASM:", err instanceof Error ? err.message : String(err));
    }

    try {
      this.transcriber = await loadModel("wasm", "q8");
      this.runtimeInfo = { device: "wasm", dtype: "q8", logicalCores, crossOriginIsolated: isolated };
      console.info("[meeting] Whisper loaded", { device: "wasm", dtype: "q8" });
    } catch (err) {
      // The model's `_quantized` q8 export currently fails in ORT with a
      // missing-scale error. Try the repo's explicit int8 export first; it
      // uses standard integer operators rather than the failing MatMulNBits
      // path, while keeping the model 8-bit quantized.
      console.warn("[meeting] Whisper q8 WASM load failed, trying int8 WASM:", err instanceof Error ? err.message : String(err));
      try {
        this.transcriber = await loadModel("wasm", "int8");
        this.runtimeInfo = { device: "wasm", dtype: "int8", logicalCores, crossOriginIsolated: isolated };
        console.info("[meeting] Whisper loaded", { device: "wasm", dtype: "int8", fallbackFrom: "q8" });
      } catch (int8Err) {
        console.warn("[meeting] Whisper int8 WASM load failed, trying uint8 WASM:", int8Err instanceof Error ? int8Err.message : String(int8Err));
        try {
          this.transcriber = await loadModel("wasm", "uint8");
          this.runtimeInfo = { device: "wasm", dtype: "uint8", logicalCores, crossOriginIsolated: isolated };
          console.info("[meeting] Whisper loaded", { device: "wasm", dtype: "uint8", fallbackFrom: "int8" });
        } catch (uint8Err) {
          console.warn("[meeting] Whisper uint8 WASM load failed, falling back to fp32 WASM:", uint8Err instanceof Error ? uint8Err.message : String(uint8Err));
          this.transcriber = await loadModel("wasm", "fp32");
          this.runtimeInfo = { device: "wasm", dtype: "fp32", logicalCores, crossOriginIsolated: isolated };
          console.info("[meeting] Whisper loaded", { device: "wasm", dtype: "fp32", fallbackFrom: "uint8" });
        }
      }
    }
  }

  /** Called by the caller (via sttWorker.ts's "setLanguage" message) once
   *  the user has picked a language on MeetingHome.tsx — updates the
   *  already-loaded model's language for every following transcribe() call,
   *  including whisper.cpp's closure (which reads `this.language` fresh
   *  each call rather than a value captured at load time). */
  setLanguage(language: string): void {
    this.language = language;
  }

  getRuntimeInfo() {
    return this.runtimeInfo;
  }

  async transcribe(audio: Float32Array, sampleRate: number): Promise<STTResult> {
    // Whisper's feature extractor expects 16kHz mono. The caller
    // (lib/meeting/processing/runLocalMeetingProcessing.ts) already
    // resamples via lib/meeting/stt/audioDecode.ts before calling here, but
    // this is re-checked defensively since STTProvider is a public
    // interface any future caller could invoke directly.
    if (sampleRate !== 16_000) {
      throw new Error(`LocalWhisperProvider requires 16kHz audio, got ${sampleRate}Hz`);
    }

    await this.load();
    if (!this.transcriber) return { segments: [] };

    // Live preview submits ~10s windows. Avoid making the CPU pipeline pad
    // every short window to Whisper's 30s maximum; retain 30s for longer
    // post-recording inputs so the existing long-audio behavior is unchanged.
    const audioDurationSec = audio.length / sampleRate;
    const chunkLengthSec = Math.min(30, Math.max(10, Math.ceil(audioDurationSec)));
    // Transformers.js does NOT auto-detect language — omitting it silently
    // defaults generation to English regardless of the audio's actual
    // language (see WhisperForConditionalGeneration._retrieve_init_tokens).
    // whisper.cpp's transcriber closure ignores this options object (its
    // language is fixed at load time instead, and accepts "auto" directly
    // there), so passing it here is a harmless no-op on that path.
    let language = this.modelName.endsWith(".en") ? undefined : this.language;
    if (language === AUTO_STT_LANG && this.pipe) {
      language = await detectWhisperLanguage(this.pipe, audio);
    }
    const output = await this.transcriber(audio, { return_timestamps: true, chunk_length_s: chunkLengthSec, language });
    const rawChunks = output.chunks ?? [{ text: output.text, timestamp: [0, null] as [number, number | null] }];
    const segments: STTSegment[] = rawChunks
      .map((c): STTSegment => ({
        start: c.timestamp[0] ?? 0,
        end: c.timestamp[1] ?? c.timestamp[0] ?? 0,
        text: c.text.trim(),
      }))
      .filter((s) => isMeaningfulSttText(s.text));

    return { segments };
  }
}
