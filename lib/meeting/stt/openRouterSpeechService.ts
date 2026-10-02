/** OpenRouter MAI-Transcribe 2 integration for the paid STT path. */

import type { DiarizationSpan, STTSegment } from "./types";

const DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1/audio/transcriptions";
const DEFAULT_MODEL = "microsoft/mai-transcribe-2";

interface OpenRouterSpeechConfig {
  key: string;
  endpoint: string;
  model: string;
}

export interface OpenRouterTranscribeResult {
  segments: STTSegment[];
  spans: DiarizationSpan[];
  detectedLanguage?: string;
  rawDurationMs?: number;
}

export function getOpenRouterSpeechConfig(): OpenRouterSpeechConfig | null {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return null;
  return {
    key,
    endpoint: process.env.OPENROUTER_SPEECH_ENDPOINT?.trim() || DEFAULT_ENDPOINT,
    model: process.env.OPENROUTER_STT_MODEL?.trim() || DEFAULT_MODEL,
  };
}

export function createWavBufferFromPcm(pcmBytes: Buffer | ArrayBuffer, sampleRate: number): Buffer {
  const pcm = Buffer.isBuffer(pcmBytes) ? pcmBytes : Buffer.from(pcmBytes);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Sends one short PCM window through OpenRouter's dedicated STT endpoint. */
export async function transcribeChunkWithOpenRouter(
  audioPcm: Buffer | ArrayBuffer,
  sampleRate = 16000,
  language = "auto",
  offsetSec = 0,
  signal?: AbortSignal,
): Promise<OpenRouterTranscribeResult> {
  const config = getOpenRouterSpeechConfig();
  if (!config) throw new Error("OpenRouter STT is not configured. Set OPENROUTER_API_KEY.");

  const pcm = Buffer.isBuffer(audioPcm) ? audioPcm : Buffer.from(audioPcm);
  const wav = createWavBufferFromPcm(audioPcm, sampleRate);
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      "X-OpenRouter-Title": "Meeting",
    },
    body: JSON.stringify({
      model: config.model,
      input_audio: { data: wav.toString("base64"), format: "wav" },
      ...(language && language !== "auto" ? { language } : {}),
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[meeting] OpenRouter MAI transcription failed (${response.status}): ${detail}`);
    throw new Error(`OpenRouter MAI transcription failed (${response.status})`);
  }

  const data = (await response.json()) as {
    text?: string;
    language?: string;
    duration?: number;
    usage?: { seconds?: number };
    segments?: Array<{ start?: number; end?: number; text?: string; speaker?: number | string }>;
  };
  const durationSec = data.duration || data.usage?.seconds || Math.max(1, pcm.length / (sampleRate * 2));
  const sourceSegments = data.segments?.filter((segment) => segment.text?.trim()) ?? [];
  const segments = sourceSegments.length > 0
    ? sourceSegments.map((segment) => ({
        start: offsetSec + (segment.start ?? 0),
        end: offsetSec + (segment.end ?? durationSec),
        text: segment.text!.trim(),
      }))
    : data.text?.trim()
      ? [{ start: offsetSec, end: offsetSec + durationSec, text: data.text.trim() }]
      : [];
  // Numeric labels are used as-is; text labels ("A", "speaker_2") get slots in
  // order of first appearance within this response.
  const textLabelSlots = new Map<string, number>();
  const speakerIndexFor = (raw: number | string): number => {
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && numeric >= 0) return numeric;
    const key = String(raw);
    if (!textLabelSlots.has(key)) textLabelSlots.set(key, textLabelSlots.size);
    return textLabelSlots.get(key) ?? 0;
  };
  const spans = sourceSegments
    .filter((segment) => segment.speaker !== undefined)
    .map((segment) => ({
      startTime: offsetSec + (segment.start ?? 0),
      duration: Math.max(0, (segment.end ?? durationSec) - (segment.start ?? 0)),
      speakerId: String(segment.speaker),
      speakerIndex: speakerIndexFor(segment.speaker as number | string),
    }));

  return {
    segments,
    spans,
    detectedLanguage: data.language,
    rawDurationMs: Math.round(durationSec * 1000),
  };
}
