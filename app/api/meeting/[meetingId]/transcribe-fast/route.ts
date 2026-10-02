import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import {
  transcribeChunkWithOpenRouter,
  getOpenRouterSpeechConfig,
} from "@/lib/meeting/stt/openRouterSpeechService";

export const runtime = "nodejs";

// Callers (liveTranscription.ts, fastServerTranscription.ts) send at most a
// ~30-60s window of 16-bit PCM per request. At the top of the supported
// sample-rate range (48kHz mono, 2 bytes/sample) that's ~5.5MB; cap well
// above that so a legitimate chunk never gets rejected while still bounding
// how much memory and upstream cost a single request can consume.
const MAX_PCM_BYTES = 16 * 1024 * 1024;

/**
 * POST /api/meeting/[meetingId]/transcribe-fast
 *
 * Server-side endpoint for "fast (paid)" transcription using OpenRouter MAI-Transcribe 2.
 * Takes 16-bit PCM audio in request body and returns transcribed segments.
 */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  try {
    const email = await resolveMeetingCallerEmail(req);
    if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
    if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rawSampleRate = req.headers.has("x-sample-rate")
      ? Number(req.headers.get("x-sample-rate"))
      : 16000;
    if (!Number.isFinite(rawSampleRate) || rawSampleRate < 8000 || rawSampleRate > 48000) {
      return NextResponse.json({ error: "Invalid x-sample-rate header" }, { status: 400 });
    }
    const sampleRate = rawSampleRate;

    const rawOffsetSec = req.headers.has("x-offset-sec")
      ? Number(req.headers.get("x-offset-sec"))
      : 0;
    if (!Number.isFinite(rawOffsetSec) || rawOffsetSec < 0) {
      return NextResponse.json({ error: "Invalid x-offset-sec header" }, { status: 400 });
    }
    const offsetSec = rawOffsetSec;

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

    const config = getOpenRouterSpeechConfig();
    if (!config) {
      return NextResponse.json(
        {
          error: "OpenRouter STT is not configured.",
          segments: [],
          spans: [],
        },
        { status: 503 },
      );
    }

    const result = await transcribeChunkWithOpenRouter(
      Buffer.from(pcmBuffer),
      sampleRate,
      meeting.sttLanguage,
      offsetSec,
      req.signal,
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error("[meeting] Fast transcription error:", err);
    return NextResponse.json(
      {
        error: "Fast transcription failed",
        segments: [],
        spans: [],
      },
      { status: 500 },
    );
  }
}
