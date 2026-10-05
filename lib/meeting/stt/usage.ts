import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

export type SttUsagePurpose = "live" | "final" | "upload" | "reprocess" | "unknown";

export interface SttUsageRequestMeta {
  purpose: SttUsagePurpose;
  jobId?: string;
  chunkIndex?: number;
  attempt: number;
}

const PURPOSES = new Set<SttUsagePurpose>(["live", "final", "upload", "reprocess", "unknown"]);

function boundedHeader(value: string | null, maxLength: number): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function boundedInt(value: string | null, min: number, max: number): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return undefined;
  return parsed;
}

export function parseSttUsageRequestMeta(headers: Headers): SttUsageRequestMeta {
  const rawPurpose = boundedHeader(headers.get("x-stt-purpose"), 32)?.toLowerCase() as SttUsagePurpose | undefined;
  return {
    purpose: rawPurpose && PURPOSES.has(rawPurpose) ? rawPurpose : "unknown",
    jobId: boundedHeader(headers.get("x-stt-job-id"), 120),
    chunkIndex: boundedInt(headers.get("x-stt-chunk-index"), 0, 1_000_000),
    attempt: boundedInt(headers.get("x-stt-attempt"), 1, 20) ?? 1,
  };
}

/** 16-bit mono PCM contains 2 bytes per sample. */
export function calculatePcmDurationMs(inputBytes: number, sampleRate: number): number {
  if (!Number.isFinite(inputBytes) || inputBytes <= 0) return 0;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 0;
  return Math.max(1, Math.round((inputBytes / 2 / sampleRate) * 1000));
}

export interface StartPaidSttUsageInput {
  meetingId: string;
  userEmail: string;
  provider: string;
  model: string;
  sampleRate: number;
  inputBytes: number;
  audioDurationMs: number;
  meta: SttUsageRequestMeta;
}

export async function startPaidSttUsage(input: StartPaidSttUsageInput) {
  return prisma.meetingSttUsage.create({
    data: {
      requestId: randomUUID(),
      meetingId: input.meetingId,
      userEmail: input.userEmail,
      provider: input.provider,
      model: input.model,
      purpose: input.meta.purpose,
      jobId: input.meta.jobId,
      chunkIndex: input.meta.chunkIndex,
      attempt: input.meta.attempt,
      sampleRate: input.sampleRate,
      inputBytes: input.inputBytes,
      audioDurationMs: input.audioDurationMs,
      status: "STARTED",
    },
    select: {
      id: true,
      requestId: true,
      startedAt: true,
    },
  });
}

interface PaidSttSuccessInput {
  usageId: string;
  startedAt: Date;
  providerDurationMs?: number;
  providerRequestId?: string;
  providerCostUsd?: number;
  detectedLanguage?: string;
  upstreamStatusCode?: number;
}

export async function completePaidSttUsage(input: PaidSttSuccessInput): Promise<void> {
  const completedAt = new Date();
  await prisma.meetingSttUsage.update({
    where: { id: input.usageId },
    data: {
      status: "SUCCESS",
      providerDurationMs: positiveIntOrNull(input.providerDurationMs),
      providerRequestId: boundedText(input.providerRequestId, 200),
      providerCostUsd: finiteMoneyOrNull(input.providerCostUsd),
      detectedLanguage: boundedText(input.detectedLanguage, 32),
      upstreamStatusCode: input.upstreamStatusCode ?? 200,
      latencyMs: Math.max(0, completedAt.getTime() - input.startedAt.getTime()),
      completedAt,
    },
  });
}

interface PaidSttFailureInput {
  usageId: string;
  startedAt: Date;
  error: unknown;
  upstreamStatusCode?: number;
  providerRequestId?: string;
}

export async function failPaidSttUsage(input: PaidSttFailureInput): Promise<void> {
  const completedAt = new Date();
  await prisma.meetingSttUsage.update({
    where: { id: input.usageId },
    data: {
      status: "FAILED",
      upstreamStatusCode: input.upstreamStatusCode,
      providerRequestId: boundedText(input.providerRequestId, 200),
      errorMessage: boundedText(errorMessage(input.error), 2_000),
      latencyMs: Math.max(0, completedAt.getTime() - input.startedAt.getTime()),
      completedAt,
    },
  });
}

function positiveIntOrNull(value: number | undefined): number | null {
  if (!Number.isFinite(value) || !value || value <= 0) return null;
  return Math.round(value);
}

function finiteMoneyOrNull(value: number | undefined): number | null {
  if (!Number.isFinite(value) || value === undefined || value < 0) return null;
  return value;
}

function boundedText(value: string | undefined, maxLength: number): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
