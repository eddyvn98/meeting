import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isMeetingUsageServiceRequest } from "./_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_EVENT_LIMIT = 100;
const MAX_EVENT_LIMIT = 500;

function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function parseDate(raw: string | null, fallback: Date): Date | null {
  if (!raw) return fallback;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseLimit(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_EVENT_LIMIT
    ? parsed
    : DEFAULT_EVENT_LIMIT;
}

function decimal(value: Prisma.Decimal | null | undefined): number {
  return value == null ? 0 : Number(value);
}

function countStatus(
  rows: Array<{ status: string; _count: { _all: number } }>,
  status: string,
): number {
  return rows.find((row) => row.status === status)?._count._all ?? 0;
}

function pricesFor(
  rows: Array<{ currency: string | null; _sum: { totalPrice: Prisma.Decimal | null } }>,
): Record<string, number> {
  return Object.fromEntries(
    rows
      .filter((row): row is typeof row & { currency: string } => Boolean(row.currency))
      .map((row) => [row.currency, decimal(row._sum.totalPrice)]),
  );
}

export async function GET(req: NextRequest) {
  if (!isMeetingUsageServiceRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const url = new URL(req.url);
  const from = parseDate(url.searchParams.get("from"), monthStartUtc(now));
  const to = parseDate(url.searchParams.get("to"), now);
  if (!from || !to || from >= to) {
    return NextResponse.json(
      { error: "Invalid period. Use ISO timestamps where from < to." },
      { status: 400 },
    );
  }

  const userEmail = url.searchParams.get("userEmail")?.trim().toLowerCase() || undefined;
  const purpose = url.searchParams.get("purpose")?.trim().toLowerCase() || undefined;
  const app = url.searchParams.get("app")?.trim() || undefined;
  const feature = url.searchParams.get("feature")?.trim() || undefined;
  const includeEvents = url.searchParams.get("includeEvents") === "true";
  const limit = parseLimit(url.searchParams.get("limit"));

  const sttWhere: Prisma.MeetingSttUsageWhereInput = {
    startedAt: { gte: from, lt: to },
    ...(userEmail ? { userEmail } : {}),
    ...(purpose ? { purpose } : {}),
  };
  const aiWhere: Prisma.MeetingAiUsageWhereInput = {
    createdAt: { gte: from, lt: to },
    ...(userEmail ? { userEmail } : {}),
    ...(app ? { app } : {}),
    ...(feature ? { feature } : {}),
  };

  const [
    sttCount,
    sttTotals,
    sttStatuses,
    sttByUser,
    sttByUserStatuses,
    sttByPurpose,
    sttEvents,
    aiCount,
    aiTotals,
    aiStatuses,
    aiByUser,
    aiByUserStatuses,
    aiByApp,
    aiByFeature,
    aiByModel,
    aiPrices,
    aiUserPrices,
    aiEvents,
  ] = await Promise.all([
    prisma.meetingSttUsage.count({ where: sttWhere }),
    prisma.meetingSttUsage.aggregate({
      where: sttWhere,
      _sum: {
        inputBytes: true,
        audioDurationMs: true,
        providerDurationMs: true,
        providerCostUsd: true,
      },
    }),
    prisma.meetingSttUsage.groupBy({ by: ["status"], where: sttWhere, _count: { _all: true } }),
    prisma.meetingSttUsage.groupBy({
      by: ["userEmail"],
      where: sttWhere,
      _count: { _all: true },
      _sum: { audioDurationMs: true, providerDurationMs: true, providerCostUsd: true },
    }),
    prisma.meetingSttUsage.groupBy({
      by: ["userEmail", "status"],
      where: sttWhere,
      _count: { _all: true },
    }),
    prisma.meetingSttUsage.groupBy({
      by: ["purpose"],
      where: sttWhere,
      _count: { _all: true },
      _sum: { audioDurationMs: true, providerDurationMs: true, providerCostUsd: true },
    }),
    includeEvents
      ? prisma.meetingSttUsage.findMany({
          where: sttWhere,
          orderBy: { startedAt: "desc" },
          take: limit,
          include: { meeting: { select: { title: true } } },
        })
      : Promise.resolve([]),
    prisma.meetingAiUsage.count({ where: aiWhere }),
    prisma.meetingAiUsage.aggregate({
      where: aiWhere,
      _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
    }),
    prisma.meetingAiUsage.groupBy({ by: ["status"], where: aiWhere, _count: { _all: true } }),
    prisma.meetingAiUsage.groupBy({
      by: ["userEmail"],
      where: aiWhere,
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
    }),
    prisma.meetingAiUsage.groupBy({
      by: ["userEmail", "status"],
      where: aiWhere,
      _count: { _all: true },
    }),
    prisma.meetingAiUsage.groupBy({
      by: ["app"],
      where: aiWhere,
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
    }),
    prisma.meetingAiUsage.groupBy({
      by: ["feature"],
      where: aiWhere,
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
    }),
    prisma.meetingAiUsage.groupBy({
      by: ["providerModel"],
      where: aiWhere,
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
    }),
    prisma.meetingAiUsage.groupBy({
      by: ["currency"],
      where: { ...aiWhere, currency: { not: null } },
      _sum: { totalPrice: true },
    }),
    prisma.meetingAiUsage.groupBy({
      by: ["userEmail", "currency"],
      where: { ...aiWhere, currency: { not: null } },
      _sum: { totalPrice: true },
    }),
    includeEvents
      ? prisma.meetingAiUsage.findMany({
          where: aiWhere,
          orderBy: { createdAt: "desc" },
          take: limit,
        })
      : Promise.resolve([]),
  ]);

  const sttUsers = sttByUser
    .map((row) => {
      const statuses = sttByUserStatuses.filter((item) => item.userEmail === row.userEmail);
      return {
        userEmail: row.userEmail,
        requestCount: row._count._all,
        successCount: countStatus(statuses, "SUCCESS"),
        failedCount: countStatus(statuses, "FAILED"),
        startedCount: countStatus(statuses, "STARTED"),
        audioDurationMs: row._sum.audioDurationMs ?? 0,
        providerDurationMs: row._sum.providerDurationMs ?? 0,
        providerCostUsd: decimal(row._sum.providerCostUsd),
      };
    })
    .sort((a, b) => b.audioDurationMs - a.audioDurationMs);

  const aiUsers = aiByUser
    .map((row) => {
      const statuses = aiByUserStatuses.filter((item) => item.userEmail === row.userEmail);
      const priceRows = aiUserPrices.filter((item) => item.userEmail === row.userEmail);
      return {
        userEmail: row.userEmail,
        requestCount: row._count._all,
        successCount: countStatus(statuses, "SUCCESS"),
        failedCount: row._count._all - countStatus(statuses, "SUCCESS"),
        inputTokens: row._sum.inputTokens ?? 0,
        outputTokens: row._sum.outputTokens ?? 0,
        totalTokens: row._sum.totalTokens ?? 0,
        priceByCurrency: pricesFor(priceRows),
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const tokenGroup = <T extends { _count: { _all: number }; _sum: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } }>(
    rows: T[],
  ) => rows.map((row) => ({
    ...row,
    requestCount: row._count._all,
    inputTokens: row._sum.inputTokens ?? 0,
    outputTokens: row._sum.outputTokens ?? 0,
    totalTokens: row._sum.totalTokens ?? 0,
    _count: undefined,
    _sum: undefined,
  }));

  const response = NextResponse.json({
    generatedAt: now.toISOString(),
    period: { from: from.toISOString(), to: to.toISOString() },
    filters: {
      userEmail: userEmail ?? null,
      purpose: purpose ?? null,
      app: app ?? null,
      feature: feature ?? null,
    },
    stt: {
      totals: {
        requestCount: sttCount,
        successCount: countStatus(sttStatuses, "SUCCESS"),
        failedCount: countStatus(sttStatuses, "FAILED"),
        startedCount: countStatus(sttStatuses, "STARTED"),
        inputBytes: sttTotals._sum.inputBytes ?? 0,
        audioDurationMs: sttTotals._sum.audioDurationMs ?? 0,
        providerDurationMs: sttTotals._sum.providerDurationMs ?? 0,
        providerCostUsd: decimal(sttTotals._sum.providerCostUsd),
      },
      byUser: sttUsers,
      byPurpose: sttByPurpose.map((row) => ({
        purpose: row.purpose,
        requestCount: row._count._all,
        audioDurationMs: row._sum.audioDurationMs ?? 0,
        providerDurationMs: row._sum.providerDurationMs ?? 0,
        providerCostUsd: decimal(row._sum.providerCostUsd),
      })),
      events: includeEvents
        ? sttEvents.map((event) => ({
            id: event.id,
            requestId: event.requestId,
            meetingId: event.meetingId,
            meetingTitle: event.meeting?.title ?? null,
            userEmail: event.userEmail,
            provider: event.provider,
            model: event.model,
            purpose: event.purpose,
            jobId: event.jobId,
            chunkIndex: event.chunkIndex,
            attempt: event.attempt,
            sampleRate: event.sampleRate,
            inputBytes: event.inputBytes,
            audioDurationMs: event.audioDurationMs,
            providerDurationMs: event.providerDurationMs,
            status: event.status,
            latencyMs: event.latencyMs,
            upstreamStatusCode: event.upstreamStatusCode,
            providerRequestId: event.providerRequestId,
            providerCostUsd: event.providerCostUsd == null ? null : Number(event.providerCostUsd),
            detectedLanguage: event.detectedLanguage,
            errorMessage: event.errorMessage,
            startedAt: event.startedAt.toISOString(),
            completedAt: event.completedAt?.toISOString() ?? null,
          }))
        : undefined,
    },
    ai: {
      totals: {
        requestCount: aiCount,
        successCount: countStatus(aiStatuses, "SUCCESS"),
        failedCount: aiCount - countStatus(aiStatuses, "SUCCESS"),
        inputTokens: aiTotals._sum.inputTokens ?? 0,
        outputTokens: aiTotals._sum.outputTokens ?? 0,
        totalTokens: aiTotals._sum.totalTokens ?? 0,
        priceByCurrency: pricesFor(aiPrices),
      },
      byUser: aiUsers,
      byApp: tokenGroup(aiByApp),
      byFeature: tokenGroup(aiByFeature),
      byModel: tokenGroup(aiByModel),
      events: includeEvents
        ? aiEvents.map((event) => ({
            id: event.id,
            requestId: event.requestId,
            userEmail: event.userEmail,
            provider: event.provider,
            app: event.app,
            feature: event.feature,
            attempt: event.attempt,
            requestedModel: event.requestedModel,
            providerModel: event.providerModel,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            totalTokens: event.totalTokens,
            totalPrice: event.totalPrice == null ? null : Number(event.totalPrice),
            currency: event.currency,
            latencyMs: event.latencyMs,
            httpStatus: event.httpStatus,
            status: event.status,
            providerRequestId: event.providerRequestId,
            workflowRunId: event.workflowRunId,
            errorMessage: event.errorMessage,
            createdAt: event.createdAt.toISOString(),
          }))
        : undefined,
    },
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
