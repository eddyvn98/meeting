import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { ServerDiarizationProviderReal } from "@/lib/meeting/stt/serverDiarizationProviderReal";
import { clusterEmbeddingSpans, type RawEmbeddingSpan } from "@/lib/meeting/stt/diarization/runDiarizationCore";
import { loadVoiceProfileSeeds } from "@/lib/meeting/stt/voiceLibrary";
import { acquireMeetingSttSlot, MeetingSttBusyError } from "@/lib/meeting/stt/serverSttConcurrency";

/**
 * POST /api/meeting/[meetingId]/diarize-chunk
 *
 * Speaker detection only (no transcription), for meetings whose text came
 * from the paid API but whose speakers must still be identified with our own
 * models and voice library — the API returns no voice embeddings, so its own
 * labels can't be matched to enrolled colleagues (see voiceLibrary.ts).
 *
 * Same chunked protocol as transcribe-chunk/route.ts: each request extracts
 * the speaker embeddings of ONE ~15-minute slice into an in-memory
 * per-meeting accumulator; the last request (`x-chunk-last: true`) clusters
 * every slice together, seeded with the company-wide voice library, and
 * returns the spans plus each speaker's centroid. Accumulator state is
 * in-memory, with the same single-instance tradeoff as transcribe-chunk.
 */
export const runtime = "nodejs";

interface Accumulator {
  rawSpans: RawEmbeddingSpan[];
  updatedAt: number;
}

const accumulators = new Map<string, Accumulator>();
const ACCUMULATOR_TTL_MS = 60 * 60 * 1000;
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
  if (pcmBuffer.byteLength === 0) return NextResponse.json({ error: "Empty audio body" }, { status: 400 });
  if (pcmBuffer.byteLength > MAX_PCM_BYTES) return NextResponse.json({ error: "Audio chunk too large" }, { status: 413 });

  pruneStaleAccumulators();
  const key = params.meetingId;
  // A chunk at offset 0 starts a fresh run, so a retried run never mixes in a previous attempt.
  const acc: Accumulator = offsetSec === 0 ? { rawSpans: [], updatedAt: Date.now() } : accumulators.get(key) ?? { rawSpans: [], updatedAt: Date.now() };

  let releaseSlot: (() => void) | undefined;
  try {
    releaseSlot = await acquireMeetingSttSlot();
    const rawSpans = await new ServerDiarizationProviderReal().extractEmbeddingSpans(
      decodeInt16Pcm(pcmBuffer),
      sampleRate,
      offsetSec,
    );
    acc.rawSpans.push(...rawSpans);
    acc.updatedAt = Date.now();
    accumulators.set(key, acc);
  } catch (err) {
    if (err instanceof MeetingSttBusyError) {
      return NextResponse.json({ error: "Server is busy; retry shortly." }, { status: 429, headers: { "Retry-After": "5" } });
    }
    accumulators.delete(key);
    console.warn("[meeting] Server diarization failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Speaker detection failed" }, { status: 500 });
  } finally {
    releaseSlot?.();
  }

  if (!isLast) return NextResponse.json({ ok: true });

  accumulators.delete(key);
  const { spans, centroids } = clusterEmbeddingSpans(acc.rawSpans, await loadVoiceProfileSeeds());
  return NextResponse.json({
    spans,
    centroids: centroids.map((c) => ({ speakerIndex: c.speakerIndex, embedding: Array.from(c.embedding), recognizedName: c.recognizedName })),
  });
}
