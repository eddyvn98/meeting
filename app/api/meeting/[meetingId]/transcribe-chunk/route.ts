import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { ServerWhisperProvider } from "@/lib/meeting/stt/serverWhisperProvider";
import { ServerDiarizationProviderReal } from "@/lib/meeting/stt/serverDiarizationProviderReal";
import { clusterEmbeddingSpans, type RawEmbeddingSpan } from "@/lib/meeting/stt/diarization/runDiarizationCore";
import { loadVoiceProfileSeeds } from "@/lib/meeting/stt/voiceLibrary";
import { acquireMeetingSttSlot, MeetingSttBusyError } from "@/lib/meeting/stt/serverSttConcurrency";

/**
 * POST /api/meeting/[meetingId]/transcribe-chunk
 *
 * Chunked counterpart to transcribe/route.ts for long meetings — see
 * lib/meeting/stt/chunkedServerTranscription.ts's doc comment for why a
 * long recording is sent as several ~15-minute slices instead of one giant
 * request. Each request transcribes ONE slice and extracts (but does not
 * yet cluster) its diarization speaker embeddings, appending both into an
 * in-memory per-meeting accumulator. Only the last chunk (`x-chunk-last:
 * true`) triggers the final clustering pass over every chunk's embeddings
 * TOGETHER — see runDiarizationCore.ts's extractEmbeddingSpans/
 * clusterEmbeddingSpans split — seeded against the company-wide voice
 * library (voiceLibrary.ts) so a previously-enrolled colleague is
 * auto-labeled instead of `speaker_N`, and returns the complete,
 * speaker-consistent result (plus each speaker's final centroid, for
 * transcript/route.ts to persist) for the whole meeting; every earlier
 * chunk gets a bare ack.
 *
 * Accumulator state is in-memory (not persisted) — same tradeoff
 * transcribe/route.ts's resultCache already makes: fine behind a single
 * server instance, would need a shared store (Redis, DB row) behind a
 * load balancer with multiple instances so any instance can see any
 * meeting's earlier chunks.
 */

interface AccumulatedSegment {
  start: number;
  end: number;
  text: string;
}

interface MeetingAccumulator {
  segments: AccumulatedSegment[];
  rawSpans: RawEmbeddingSpan[];
  updatedAt: number;
}

const accumulators = new Map<string, MeetingAccumulator>();
// A long meeting's chunks can take a while to arrive one at a time (each
// chunk is a real ~15-minute transcription) — generous relative to
// transcribe/route.ts's 10-minute resultCache TTL, which covers one shot.
const ACCUMULATOR_TTL_MS = 60 * 60 * 1000;

// Each chunk is at most CHUNK_DURATION_SEC (15 min) of 16-bit PCM. At the
// top of the supported sample-rate range (48kHz mono, 2 bytes/sample)
// that's ~86MB; cap generously above that to bound memory/CPU per request
// without rejecting a legitimate slice.
const MAX_PCM_BYTES = 100 * 1024 * 1024;

function pruneStaleAccumulators() {
  const now = Date.now();
  for (const [key, acc] of accumulators) {
    if (now - acc.updatedAt > ACCUMULATOR_TTL_MS) accumulators.delete(key);
  }
}

function decodeInt16Pcm(buffer: ArrayBuffer): Float32Array {
  const view = new Int16Array(buffer);
  const audio = new Float32Array(view.length);
  for (let i = 0; i < view.length; i++) audio[i] = view[i] / 32768;
  return audio;
}

export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sampleRate = Number(req.headers.get("x-sample-rate"));
  const offsetSec = Number(req.headers.get("x-chunk-offset-sec"));
  const isLast = req.headers.get("x-chunk-last") === "true";
  const textOnly = req.headers.get("x-text-only") === "true";
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    return NextResponse.json({ error: "x-sample-rate header is required" }, { status: 400 });
  }
  if (!Number.isFinite(offsetSec) || offsetSec < 0) {
    return NextResponse.json({ error: "x-chunk-offset-sec header is required" }, { status: 400 });
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

  pruneStaleAccumulators();
  const key = params.meetingId;
  const acc: MeetingAccumulator = accumulators.get(key) ?? { segments: [], rawSpans: [], updatedAt: Date.now() };

  let releaseSlot: (() => void) | undefined;
  try {
    releaseSlot = await acquireMeetingSttSlot();
    const audio = decodeInt16Pcm(pcmBuffer);
    const stt = new ServerWhisperProvider(meeting.sttLanguage);

    // Overview generation only needs text. The processing client uses this
    // mode first so it can persist STT and start Dify immediately, then runs
    // speaker detection through /diarize-chunk in the background.
    if (textOnly) {
      const sttResult = await stt.transcribe(audio, sampleRate);
      return NextResponse.json({
        segments: sttResult.segments.map((s) => ({
          start: s.start + offsetSec,
          end: s.end + offsetSec,
          text: s.text,
        })),
      });
    }

    const diarization = new ServerDiarizationProviderReal();
    const [sttResult, rawSpans] = await Promise.all([
      stt.transcribe(audio, sampleRate),
      diarization.extractEmbeddingSpans(audio, sampleRate, offsetSec).catch((err) => {
        console.warn(
          "[meeting] Chunked diarization failed for one chunk, continuing without its spans:",
          err instanceof Error ? err.message : String(err),
        );
        return [] as RawEmbeddingSpan[];
      }),
    ]);

    acc.segments.push(
      ...sttResult.segments.map((s) => ({ start: s.start + offsetSec, end: s.end + offsetSec, text: s.text })),
    );
    acc.rawSpans.push(...rawSpans);
    acc.updatedAt = Date.now();
    accumulators.set(key, acc);
  } catch (err) {
    if (err instanceof MeetingSttBusyError) {
      return NextResponse.json({ error: "Server STT is busy; retry shortly." }, { status: 429, headers: { "Retry-After": "5" } });
    }
    if (!textOnly) accumulators.delete(key);
    console.warn("[meeting] Chunked transcription failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
  } finally {
    releaseSlot?.();
  }

  if (!isLast) return NextResponse.json({ ok: true });

  accumulators.delete(key);
  const seedProfiles = await loadVoiceProfileSeeds();
  const { spans, centroids } = clusterEmbeddingSpans(acc.rawSpans, seedProfiles);
  return NextResponse.json({ segments: acc.segments, spans, centroids: serializeCentroids(centroids) });
}

function serializeCentroids(centroids: { speakerIndex: number; embedding: Float32Array; recognizedName?: string }[]) {
  return centroids.map((c) => ({ speakerIndex: c.speakerIndex, embedding: Array.from(c.embedding), recognizedName: c.recognizedName }));
}
