/**
 * lib/meeting/stt/serverWhisperProvider.ts
 *
 * Server-side (Node) counterpart to localWhisperProvider.ts, used by
 * app/api/meeting/[meetingId]/transcribe/route.ts (the server-fallback tier
 * — see providerFactory.ts). Runs @huggingface/transformers' Node backend
 * (onnxruntime-node) instead of the browser's onnxruntime-web/WASM.
 *
 * An earlier version of this file shelled out to a Python (faster-whisper)
 * subprocess after "Tensor is not a constructor" / "invalid data location"
 * errors looked like an upstream transformers.js bug. They weren't: this
 * project's node_modules had a stale, orphaned onnxruntime-common@1.14.0
 * (leftover from before the project used pnpm) that Node's bare
 * `import "onnxruntime-common"` resolution picked up ahead of the real
 * 1.24.3 the current onnxruntime-node needs, plus onnxruntime-node's own
 * native-binding postinstall script was never approved
 * (pnpm-workspace.yaml's `allowBuilds` had a literal placeholder value).
 * Fixing both (see pnpm-workspace.yaml, package.json's explicit
 * onnxruntime-common dependency) made the plain JS pipeline work correctly
 * end to end — confirmed 2026-09-07 against this project's own real
 * recorded meeting audio, matching the browser (onnxruntime-web) path,
 * which was fixed by the exact same node_modules cleanup.
 */

import type { STTProvider, STTResult, STTSegment } from "./types";
import { isMeaningfulSttText } from "./filterHallucinations";
import { detectWhisperLanguage } from "./detectWhisperLanguage";
import { AUTO_STT_LANG } from "../sttLanguages";

type WhisperOutput = { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] };
type Transcriber = (
  audio: Float32Array,
  options: { return_timestamps: boolean; chunk_length_s: number; language?: string },
) => Promise<WhisperOutput>;
type WhisperPipeline = Transcriber & Parameters<typeof detectWhisperLanguage>[0];

let pipePromise: Promise<WhisperPipeline> | null = null;

/** Returns the raw Transformers.js pipeline object — it's directly callable
 *  (the Transcriber shape) AND exposes .model/.processor/.tokenizer, which
 *  "auto" language needs for detectWhisperLanguage()'s low-level
 *  model.generate() call (see that file's doc comment for why the
 *  high-level pipeline call alone can't do this). */
async function getPipe(): Promise<WhisperPipeline> {
  if (!pipePromise) {
    pipePromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowLocalModels = false;
      return (await pipeline("automatic-speech-recognition", "onnx-community/whisper-large-v3-turbo", {
        dtype: {
          encoder_model: "q8",
          decoder_model_merged: "q8",
        },
      })) as unknown as WhisperPipeline;
    })().catch((err) => {
      // Don't cache a rejected promise — this is the last-resort server
      // fallback tier, so a single transient failure (e.g. a cold-start
      // network blip fetching the model) would otherwise permanently break
      // transcription for every meeting on this process until it restarts.
      pipePromise = null;
      throw err;
    });
  }
  return pipePromise;
}

export class ServerWhisperProvider implements STTProvider {
  readonly id = "server-whisper-transformers-js-node";

  /** @param language Whisper language code (e.g. "vi", "en") — the caller
   *  (transcribe/route.ts) resolves this from the meeting's stored
   *  `sttLanguage` (lib/meeting/sttLanguages.ts). Transformers.js does NOT
   *  auto-detect language: omitting it from generate() silently defaults to
   *  English regardless of the audio's actual language (see
   *  WhisperForConditionalGeneration._retrieve_init_tokens in
   *  @huggingface/transformers), so this is required, not optional. */
  constructor(private readonly language: string) {}

  async transcribe(audio: Float32Array, sampleRate: number): Promise<STTResult> {
    if (sampleRate !== 16_000) {
      throw new Error(`ServerWhisperProvider requires 16kHz audio, got ${sampleRate}Hz`);
    }
    const pipe = await getPipe();
    const language = this.language === AUTO_STT_LANG ? await detectWhisperLanguage(pipe, audio) : this.language;
    const output = await pipe(audio, { return_timestamps: true, chunk_length_s: 30, language });
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
