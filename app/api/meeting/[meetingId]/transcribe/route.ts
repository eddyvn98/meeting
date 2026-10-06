import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { ServerWhisperProvider } from "@/lib/meeting/stt/serverWhisperProvider";
import { ServerDiarizationProviderReal } from "@/lib/meeting/stt/serverDiarizationProviderReal";
import { acquireMeetingSttSlot, MeetingSttBusyError } from "@/lib/meeting/stt/serverSttConcurrency";
import { serverTranscriptionCacheKey } from "@/lib/meeting/stt/serverTranscriptionCacheKey";

/**
 * POST /api/meeting/[meetingId]/transcribe
 *
 * Server-fallback STT/diarization endpoint backing
 * lib/meeting/stt/serverProvider.ts (ServerSTTProvider /
 * ServerDiarizationProvider) — used only when the browser's local (WASM)
 * providers fail to load (see providerFactory.ts). Runs real transcription +
 * diarization server-side in Node via serverWhisperProvider.ts /
 * serverDiarizationProviderReal.ts, which use onnxruntime-node (a stable
 * release) instead of the browser's broken onnxruntime-web dev-nightly — see
 * those files' doc comments for why that's a real fix, not a workaround.
 *
 * Body is raw 16-bit PCM (mono, little-endian) at the sample rate given by
 * the `x-sample-rate` header — not JSON, to avoid inflating a multi-MB audio
 * buffer through base64/JSON encoding.
 *
 * runLocalMeetingProcessing.ts calls stt.transcribe() and
 * diarization.diarize() independently, which both round-trip through this
 * same endpoint with the same audio — `resultCache` below de-dupes that
 * so a single POST body triggers the (slow) model inference only once per
 * meeting, not twice.
 */

interface CachedResult {
  promise: Promise<{ segments: unknown[]; spans: unknown[] }>;
  createdAt: number;
}

const resultCache = new Map<string, CachedResult>();
const CACHE_TTL_MS = 10 * 60 * 1000;

// Callers (serverProvider.ts) send at most one CHUNK_DURATION_SEC (15 min)
// slice of 16-bit PCM per request. At the top of the supported sample-rate
// range (48kHz mono, 2 bytes/sample) that's ~86MB; cap generously above
// that to bound memory/CPU per request without rejecting a legitimate slice.
const MAX_PCM_BYTES = 100 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sampleRate = Number(req.headers.get("x-sample-rate"));
  if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 48_000) {
    return NextResponse.json({ error: "x-sample-rate must be between 8000 and 48000 Hz" }, { status: 400 });
  }

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_PCM_BYTES) {
    return NextResponse.json({ error: "Audio chunk too large" }, { status: 413 });
  }

  const pcmBuffer = await req.arrayBuffer();
  if (pcmBuffer.byteLength === 0) {
    return NextResponse.json({ error: "Empty audio body" }, { status: 400 });
  }
  if (pcmBuffer.byteLength > MAX_PCM_BYTES) {
    return NextResponse.json({ error: "Audio chunk too large" }, { status: 413 });
  }
  if (pcmBuffer.byteLength % 2 !== 0) {
    return NextResponse.json({ error: "PCM body must contain complete 16-bit samples" }, { status: 400 });
  }

  for (const [key, cached] of resultCache) {
    if (Date.now() - cached.createdAt > CACHE_TTL_MS) resultCache.delete(key);
  }

  const cacheKey = serverTranscriptionCacheKey({
    meetingId: params.meetingId,
    pcmBuffer,
    sampleRate,
    sttLanguage: meeting.sttLanguage,
  });
  const cached = resultCache.get(cacheKey);
  const resultPromise =
    cached?.promise ??
    runTranscription(pcmBuffer, sampleRate, meeting.sttLanguage);
  if (!cached) {
    resultCache.set(cacheKey, { promise: resultPromise, createdAt: Date.now() });
  }

  try {
    const result = await resultPromise;
    return NextResponse.json(result);
  } catch (err) {
    if (resultCache.get(cacheKey)?.promise === resultPromise) {
      resultCache.delete(cacheKey);
    }
    if (err instanceof MeetingSttBusyError) {
      return NextResponse.json({ error: "Server STT is busy; retry shortly." }, { status: 429, headers: { "Retry-After": "5" } });
    }
    console.warn("[meeting] Server transcription failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
  }
}

function decodeInt16Pcm(buffer: ArrayBuffer): Float32Array {
  const view = new Int16Array(buffer);
  const audio = new Float32Array(view.length);
  for (let i = 0; i < view.length; i++) audio[i] = view[i] / 32768;
  return audio;
}

async function runTranscription(pcmBuffer: ArrayBuffer, sampleRate: number, sttLanguage: string) {
  const releaseSlot = await acquireMeetingSttSlot();
  try {
  const audio = decodeInt16Pcm(pcmBuffer);
  const stt = new ServerWhisperProvider(sttLanguage);
  const diarization = new ServerDiarizationProviderReal();

  const [sttResult, diarizationResult] = await Promise.all([
    stt.transcribe(audio, sampleRate),
    diarization.diarize(audio, sampleRate).catch((err) => {
      console.warn("[meeting] Server diarization failed, continuing without speaker spans:", err instanceof Error ? err.message : String(err));
      return { spans: [] };
    }),
  ]);

  return { segments: sttResult.segments, spans: diarizationResult.spans };
  } finally {
    releaseSlot();
  }
}
