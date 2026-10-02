/**
 * lib/meeting/stt/detectWhisperLanguage.ts
 *
 * Real language auto-detection for the Transformers.js Whisper pipeline
 * (localWhisperProvider.ts's webgpu/wasm-fallback branches, and
 * serverWhisperProvider.ts) — used only when the user picks "auto" on
 * MeetingHome.tsx's language selector (whisper.cpp's branch already
 * supports "auto" natively and never calls this).
 *
 * Transformers.js's high-level pipeline always forces a language onto
 * generate() when the model is multilingual (see
 * WhisperForConditionalGeneration._retrieve_init_tokens — no language given
 * silently defaults to English), so there is no `language: "auto"` this
 * library accepts directly. This reimplements the same one-token trick
 * OpenAI Whisper's own `detect_language()` uses: `generate()`'s
 * `_retrieve_init_tokens` default is only applied when `decoder_input_ids`
 * is omitted (see that method in @huggingface/transformers) — passing just
 * `[decoder_start_token_id]` (the "<|startoftranscript|>" token, with no
 * forced language token after it) and asking for exactly one more token
 * makes the model predict its own best-guess language token at that
 * position, which is then decoded back to a code (e.g. "<|vi|>" -> "vi").
 * Confirmed against a real recorded Vietnamese meeting chunk: detected "vi"
 * and produced an identical transcript to forcing language="vi" directly.
 *
 * Uses only the already-loaded model/processor/tokenizer — no extra model
 * download, no extra RAM beyond one tiny extra forward pass per call.
 */

interface WhisperPipelineLike {
  model: {
    generate(options: {
      inputs: unknown;
      decoder_input_ids: number[];
      max_new_tokens: number;
    }): Promise<{ tolist(): number[] }[]>;
    generation_config: { decoder_start_token_id: number };
  };
  processor: (audio: Float32Array) => Promise<{ input_features: unknown }>;
  tokenizer: { decode(ids: number[]): string };
}

export async function detectWhisperLanguage(pipe: WhisperPipelineLike, audio: Float32Array): Promise<string> {
  const { input_features } = await pipe.processor(audio);
  const output = await pipe.model.generate({
    inputs: input_features,
    decoder_input_ids: [pipe.model.generation_config.decoder_start_token_id],
    max_new_tokens: 1,
  });
  const ids = output[0].tolist();
  const token = pipe.tokenizer.decode([ids[ids.length - 1]]);
  const code = token.replace(/^<\|/, "").replace(/\|>$/, "");
  return code;
}
