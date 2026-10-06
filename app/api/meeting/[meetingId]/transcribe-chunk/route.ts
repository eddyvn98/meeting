import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { ServerWhisperProvider } from "@/lib/meeting/stt/serverWhisperProvider";
import { ServerDiarizationProviderReal } from "@/lib/meeting/stt/serverDiarizationProviderReal";
import { clusterEmbeddingSpans, type RawEmbeddingSpan } from "@/lib/meeting/stt/diarization/runDiarizationCore";
import { loadVoiceProfileSeeds } from "@/lib/meeting/stt/voiceLibrary";
import { acquireMeetingSttSlot, MeetingSttBusyError } from "@/lib/meeting/stt/serverSttConcurrency";
import { missingChunkIndexes, parseChunkRunHeaders } from "@/lib/meeting/stt/chunkRunProtocol";

/**
 * POST /api/meeting/[meetingId]/transcribe-chunk
 *
 * Long recordings are sent sequentially in ~15-minute PCM slices. Non-text
 * mode keeps speaker embeddings across slices so clustering is consistent for
 * the whole meeting. The accumulator is intentionally process-local, but the
 * explicit run id + chunk index/count protocol makes that safe: if the Node
 * process restarts, any later chunk fails with CHUNK_RUN_LOST and the client
 * restarts the whole run from chunk 0 instead of silently returning a partial
 * whole-meeting result.
 */

interface AccumulatedSegment {
  start: number;
  end: number;
  text: string;
}

interface MeetingAccumulator {
  segments: AccumulatedSegment[];
  rawSpans: RawEmbeddingSpan[];
  received: Set<number>;
  chunkCount: number;
  sampleRate: number;
  updatedAt: number;
}

const accumulators = new Map<string, MeetingAccumulator>();
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
  if (!protocol.ok) {
    return NextResponse.json({ error: protocol.error }, { status: 400 });
  }
  const { runId, chunkIndex, chunkCount } = protocol.value;
  const isLast = chunkIndex === chunkCount - 1;

  const sampleRate = Number(req.headers.get("x-sample-rate"));
  const offsetSec = Number(req.headers.get("x-chunk-offset-sec"));
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

  let releaseSlot: (() => void) | undefined;
  try {
    releaseSlot = await acquireMeetingSttSlot();
    const audio = decodeInt16Pcm(pcmBuffer);
    const stt = new ServerWhisperProvider(meeting.sttLanguage);

    // Text-only processing has no cross-chunk server state: each result is
    // returned immediately and the browser combines them.
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

    pruneStaleAccumulators();
    const key = `${params.meetingId}:${runId}`;
    let acc = accumulators.get(key);

    if (chunkIndex === 0) {
      // A retried chunk 0 deliberately restarts this run. Sequential clients
      // cannot have later chunks committed before chunk 0 is acknowledged.
      acc = {
        segments: [],
        rawSpans: [],
        received: new Set<number>(),
        chunkCount,
        sampleRate,
        updatedAt: Date.now(),
      };
      accumulators.set(key, acc);
    } else if (!acc) {
      return NextResponse.json(
        {
          error: "Chunk run state was lost; restart from chunk 0.",
          code: "CHUNK_RUN_LOST",
        },
        { status: 409 },
      );
    }

    if (acc.chunkCount !== chunkCount || acc.sampleRate !== sampleRate) {
      accumulators.delete(key);
      return NextResponse.json(
        {
          error: "Chunk run parameters changed; restart from chunk 0.",
          code: "CHUNK_RUN_MISMATCH",
        },
        { status: 409 },
      );
    }

    if (!acc.received.has(chunkIndex)) {
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
        ...sttResult.segments.map((s) => ({
          start: s.start + offsetSec,
          end: s.end + offsetSec,
          text: s.text,
        })),
      );
      acc.rawSpans.push(...rawSpans);
      acc.received.add(chunkIndex);
      acc.updatedAt = Date.now();
      accumulators.set(key, acc);
    }

    if (!isLast) return NextResponse.json({ ok: true, duplicate: acc.received.has(chunkIndex) });

    const missing = missingChunkIndexes(acc.received, chunkCount);
    if (missing.length > 0) {
      accumulators.delete(key);
      return NextResponse.json(
        {
          error: "Chunk run is incomplete; restart from chunk 0.",
          code: "CHUNK_RUN_INCOMPLETE",
          missingChunkIndices: missing,
        },
        { status: 409 },
      );
    }

    accumulators.delete(key);
    const seedProfiles = await loadVoiceProfileSeeds();
    const { spans, centroids } = clusterEmbeddingSpans(acc.rawSpans, seedProfiles);
    return NextResponse.json({
      segments: acc.segments,
      spans,
      centroids: serializeCentroids(centroids),
    });
  } catch (err) {
    if (err instanceof MeetingSttBusyError) {
      return NextResponse.json(
        { error: "Server STT is busy; retry shortly." },
        { status: 429, headers: { "Retry-After": "5" } },
      );
    }
    const key = `${params.meetingId}:${runId}`;
    if (!textOnly) accumulators.delete(key);
    console.warn("[meeting] Chunked transcription failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
  } finally {
    releaseSlot?.();
  }
}

function serializeCentroids(
  centroids: { speakerIndex: number; embedding: Float32Array; recognizedName?: string }[],
) {
  return centroids.map((c) => ({
    speakerIndex: c.speakerIndex,
    embedding: Array.from(c.embedding),
    recognizedName: c.recognizedName,
  }));
}
