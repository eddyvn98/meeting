import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { ServerDiarizationProviderReal } from "@/lib/meeting/stt/serverDiarizationProviderReal";
import { clusterEmbeddingSpans, type RawEmbeddingSpan } from "@/lib/meeting/stt/diarization/runDiarizationCore";
import { loadVoiceProfileSeeds } from "@/lib/meeting/stt/voiceLibrary";
import { acquireMeetingSttSlot, MeetingSttBusyError } from "@/lib/meeting/stt/serverSttConcurrency";
import { missingChunkIndexes, parseChunkRunHeaders } from "@/lib/meeting/stt/chunkRunProtocol";

/**
 * POST /api/meeting/[meetingId]/diarize-chunk
 *
 * Speaker detection only. The accumulator is process-local, but every run
 * carries an explicit id and chunk index/count. If the server restarts between
 * chunks, a later chunk fails with CHUNK_RUN_LOST and the client restarts from
 * chunk 0 rather than clustering only the tail of the meeting.
 */
export const runtime = "nodejs";

interface Accumulator {
  rawSpans: RawEmbeddingSpan[];
  received: Set<number>;
  chunkCount: number;
  sampleRate: number;
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

  const protocol = parseChunkRunHeaders(req.headers);
  if (!protocol.ok) return NextResponse.json({ error: protocol.error }, { status: 400 });
  const { runId, chunkIndex, chunkCount } = protocol.value;
  const isLast = chunkIndex === chunkCount - 1;

  const sampleRate = Number(req.headers.get("x-sample-rate"));
  const offsetSec = Number(req.headers.get("x-chunk-offset-sec"));
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
  const key = `${params.meetingId}:${runId}`;
  let acc = accumulators.get(key);

  if (chunkIndex === 0) {
    acc = {
      rawSpans: [],
      received: new Set<number>(),
      chunkCount,
      sampleRate,
      updatedAt: Date.now(),
    };
    accumulators.set(key, acc);
  } else if (!acc) {
    return NextResponse.json(
      { error: "Speaker-detection run state was lost; restart from chunk 0.", code: "CHUNK_RUN_LOST" },
      { status: 409 },
    );
  }

  if (acc.chunkCount !== chunkCount || acc.sampleRate !== sampleRate) {
    accumulators.delete(key);
    return NextResponse.json(
      { error: "Speaker-detection run parameters changed; restart from chunk 0.", code: "CHUNK_RUN_MISMATCH" },
      { status: 409 },
    );
  }

  let releaseSlot: (() => void) | undefined;
  try {
    if (!acc.received.has(chunkIndex)) {
      releaseSlot = await acquireMeetingSttSlot();
      const rawSpans = await new ServerDiarizationProviderReal().extractEmbeddingSpans(
        decodeInt16Pcm(pcmBuffer),
        sampleRate,
        offsetSec,
      );
      acc.rawSpans.push(...rawSpans);
      acc.received.add(chunkIndex);
      acc.updatedAt = Date.now();
      accumulators.set(key, acc);
    }
  } catch (err) {
    if (err instanceof MeetingSttBusyError) {
      return NextResponse.json(
        { error: "Server is busy; retry shortly." },
        { status: 429, headers: { "Retry-After": "5" } },
      );
    }
    accumulators.delete(key);
    console.warn("[meeting] Server diarization failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Speaker detection failed" }, { status: 500 });
  } finally {
    releaseSlot?.();
  }

  if (!isLast) return NextResponse.json({ ok: true });

  const missing = missingChunkIndexes(acc.received, chunkCount);
  if (missing.length > 0) {
    accumulators.delete(key);
    return NextResponse.json(
      {
        error: "Speaker-detection run is incomplete; restart from chunk 0.",
        code: "CHUNK_RUN_INCOMPLETE",
        missingChunkIndices: missing,
      },
      { status: 409 },
    );
  }

  accumulators.delete(key);
  const { spans, centroids } = clusterEmbeddingSpans(acc.rawSpans, await loadVoiceProfileSeeds());
  return NextResponse.json({
    spans,
    centroids: centroids.map((c) => ({
      speakerIndex: c.speakerIndex,
      embedding: Array.from(c.embedding),
      recognizedName: c.recognizedName,
    })),
  });
}
