/**
 * lib/meeting/stt/audioDecode.ts
 *
 * Browser-only: decodes an audio Blob (any format the browser's decoder
 * supports — webm/opus, m4a, wav, mp3) into mono Float32Array PCM at 16kHz,
 * the sample rate Whisper's feature extractor expects
 * (lib/meeting/stt/localWhisperProvider.ts). Uses OfflineAudioContext for
 * the resample + downmix step instead of a hand-rolled interpolator — it's a
 * standard, already-correct browser API, so no extra dependency is needed.
 */

const WHISPER_SAMPLE_RATE = 16_000;

export async function decodeAudioTo16kMono(blob: Blob): Promise<{ audio: Float32Array; sampleRate: number }> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioContextCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const decodeCtx = new AudioContextCtor();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    void decodeCtx.close();
  }

  // OfflineAudioContext down-mixes any source channel count to the
  // destination's `numberOfChannels` (1 here) per the Web Audio spec's
  // default "speakers"/"max" channel-interpretation rules.
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE), WHISPER_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  return { audio: rendered.getChannelData(0), sampleRate: WHISPER_SAMPLE_RATE };
}
