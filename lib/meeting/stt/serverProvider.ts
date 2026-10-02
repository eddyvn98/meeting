/**
 * lib/meeting/stt/serverProvider.ts
 *
 * Server-fallback STT/diarization providers — used when no local WASM
 * engine is available or has failed to load (see providerFactory.ts for the
 * selection order). Calls app/api/meeting/[meetingId]/transcribe/route.ts,
 * which runs real transcription + diarization server-side in Node (see that
 * route's doc comment for why Node instead of the browser fixes the
 * onnxruntime-web bug local providers hit).
 *
 * Both providers need a `meetingId` because the transcribe endpoint is
 * scoped under /api/meeting/[meetingId]/ (matching every other route in
 * app/api/meeting/**) rather than being a stateless upload endpoint — so
 * construct these per-meeting, not once globally.
 */

import type {
  DiarizationProvider,
  DiarizationResult,
  STTProvider,
  STTResult,
} from "./types";

interface TranscribeResponseBody {
  segments?: { start: number; end: number; text: string }[];
  spans?: { startTime: number; duration: number; speakerId: string; speakerIndex: number }[];
}

/** Also used by chunkedServerTranscription.ts, which POSTs several slices of
 *  the same recording through this same wire format one at a time. */
export function encodeFloat32AsInt16Pcm(audio: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(audio.length * 2);
  const view = new Int16Array(buffer);
  for (let i = 0; i < audio.length; i++) {
    const clamped = Math.max(-1, Math.min(1, audio[i]));
    view[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
  }
  return buffer;
}

async function postAudioForTranscription(
  meetingId: string,
  audio: Float32Array,
  sampleRate: number,
): Promise<TranscribeResponseBody> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`/api/meeting/${encodeURIComponent(meetingId)}/transcribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-sample-rate": String(sampleRate),
      },
      // Raw 16-bit PCM, not JSON — a multi-minute recording at 16kHz would be
      // multiple MB of samples; base64/JSON would inflate that further and is
      // needlessly slow to parse server-side.
      body: encodeFloat32AsInt16Pcm(audio),
    });
    if (res.status !== 429 || attempt >= 4) break;
    const retryAfterSec = Number(res.headers.get("Retry-After")) || 5;
    await new Promise((resolve) => setTimeout(resolve, Math.min(15, retryAfterSec) * 1000));
  }

  if (!res.ok) {
    throw new Error(`Server transcribe request failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as TranscribeResponseBody;
}

export class ServerSTTProvider implements STTProvider {
  readonly id = "server";
  constructor(private readonly meetingId: string) {}

  async transcribe(audio: Float32Array, sampleRate: number): Promise<STTResult> {
    const body = await postAudioForTranscription(this.meetingId, audio, sampleRate);
    return { segments: body.segments ?? [] };
  }
}

export class ServerDiarizationProvider implements DiarizationProvider {
  readonly id = "server";
  constructor(private readonly meetingId: string) {}

  async diarize(audio: Float32Array, sampleRate: number): Promise<DiarizationResult> {
    const body = await postAudioForTranscription(this.meetingId, audio, sampleRate);
    return { spans: body.spans ?? [] };
  }
}
