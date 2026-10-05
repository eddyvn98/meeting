import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import {
  transcribeChunkWithOpenRouter,
  getOpenRouterSpeechConfig,
  OpenRouterSpeechError,
} from "@/lib/meeting/stt/openRouterSpeechService";
import {
  calculatePcmDurationMs,
  completePaidSttUsage,
  failPaidSttUsage,
  parseSttUsageRequestMeta,
  startPaidSttUsage,
} from "@/lib/meeting/stt/usage";

export const runtime = "nodejs";

const MAX_PCM_BYTES = 16 * 1024 * 1024;

/**
 * Paid/cloud STT endpoint. Every accepted upstream attempt gets a durable
 * usage row before the provider is called, so live/final/retry traffic can
 * be attributed to the authenticated Meeting user without provider billing
 * access.
 */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  let usage: { id: string; startedAt: Date } | null = null;

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
        { error: "OpenRouter STT is not configured.", segments: [], spans: [] },
        { status: 503 },
      );
    }

    usage = await startPaidSttUsage({
      meetingId: meeting.id,
      userEmail: email,
      provider: "openrouter",
      model: config.model,
      sampleRate,
      inputBytes: pcmBuffer.byteLength,
      audioDurationMs: calculatePcmDurationMs(pcmBuffer.byteLength, sampleRate),
      meta: parseSttUsageRequestMeta(req.headers),
    });

    const result = await transcribeChunkWithOpenRouter(
      Buffer.from(pcmBuffer),
      sampleRate,
      meeting.sttLanguage,
      offsetSec,
      req.signal,
    );

    await completePaidSttUsage({
      usageId: usage.id,
      startedAt: usage.startedAt,
      providerDurationMs: result.rawDurationMs,
      providerRequestId: result.providerRequestId,
      providerCostUsd: result.providerCostUsd,
      detectedLanguage: result.detectedLanguage,
      upstreamStatusCode: result.upstreamStatusCode,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (usage) {
      await failPaidSttUsage({
        usageId: usage.id,
        startedAt: usage.startedAt,
        error: err,
        upstreamStatusCode: err instanceof OpenRouterSpeechError ? err.status : undefined,
        providerRequestId: err instanceof OpenRouterSpeechError ? err.providerRequestId : undefined,
      }).catch((trackingError) => {
        console.error("[meeting] Failed to finalize STT usage:", trackingError);
      });
    }

    console.error("[meeting] Fast transcription error:", err);
    return NextResponse.json(
      { error: "Fast transcription failed", segments: [], spans: [] },
      { status: 500 },
    );
  }
}
