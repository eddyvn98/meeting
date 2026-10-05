import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSttUsageServiceRequest } from "./_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EVENT_LIMIT = 500;
const DEFAULT_EVENT_LIMIT = 100;

function currentMonthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function parseDate(raw: string | null, fallback: Date): Date | null {
  if (!raw) return fallback;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function intParam(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function statusCount(rows: Array<{ status: string; _count: { _all: number } }>, status: string): number {
  return rows.find((row) => row.status === status)?._count._all ?? 0;
}

function money(value: Prisma.Decimal | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value);
}

export async function GET(req: NextRequest) {
  if (!isSttUsageServiceRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const url = new URL(req.url);
  const from = parseDate(url.searchParams.get("from"), currentMonthStartUtc(now));
  const to = parseDate(url.searchParams.get("to"), now);
  if (!from || !to || from >= to) {
    return NextResponse.json(
      { error: "Invalid period. Use ISO timestamps where from < to." },
      { status: 400 },
    );
  }

  const userEmail = url.searchParams.get("userEmail")?.trim().toLowerCase() || undefined;
  const meetingId = url.searchParams.get("meetingId")?.trim() || undefined;
  const purpose = url.searchParams.get("purpose")?.trim().toLowerCase() || undefined;
  const includeEvents = url.searchParams.get("includeEvents") === "true";
  const limit = intParam(url.searchParams.get("limit"), DEFAULT_EVENT_LIMIT, 1, MAX_EVENT_LIMIT);

  const where: Prisma.MeetingSttUsageWhereInput = {
    startedAt: { gte: from, lt: to },
    ...(userEmail ? { userEmail } : {}),
    ...(meetingId ? { meetingId } : {}),
    ...(purpose ? { purpose } : {}),
  };

  const [
    requestCount,
    totals,
    statusRows,
    byUserRows,
    byUserStatusRows,
    byPurposeRows,
    byPurposeStatusRows,
    costReportedRequests,
    recentEvents,
  ] = await Promise.all([
    prisma.meetingSttUsage.count({ where }),
    prisma.meetingSttUsage.aggregate({
      where,
      _sum: {
        inputBytes: true,
        audioDurationMs: true,
        providerDurationMs: true,
        providerCostUsd: true,
      },
    }),
    prisma.meetingSttUsage.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
    prisma.meetingSttUsage.groupBy({
      by: ["userEmail"],
      where,
      _count: { _all: true },
      _sum: {
        audioDurationMs: true,
        providerDurationMs: true,
        providerCostUsd: true,
      },
      orderBy: { _sum: { audioDurationMs: "desc" } },
    }),
    prisma.meetingSttUsage.groupBy({
      by: ["userEmail", "status"],
      where,
      _count: { _all: true },
    }),
    prisma.meetingSttUsage.groupBy({
      by: ["purpose"],
      where,
      _count: { _all: true },
      _sum: {
        audioDurationMs: true,
        providerDurationMs: true,
        providerCostUsd: true,
      },
      orderBy: { _sum: { audioDurationMs: "desc" } },
    }),
    prisma.meetingSttUsage.groupBy({
      by: ["purpose", "status"],
      where,
      _count: { _all: true },
    }),
    prisma.meetingSttUsage.count({
      where: { ...where, providerCostUsd: { not: null } },
    }),
    includeEvents
      ? prisma.meetingSttUsage.findMany({
          where,
          orderBy: { startedAt: "desc" },
          take: limit,
          include: {
            meeting: { select: { title: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const byUser = byUserRows.map((row) => {
    const statuses = byUserStatusRows.filter((item) => item.userEmail === row.userEmail);
    return {
      userEmail: row.userEmail,
      requestCount: row._count._all,
      successCount: statusCount(statuses, "SUCCESS"),
      failedCount: statusCount(statuses, "FAILED"),
      startedCount: statusCount(statuses, "STARTED"),
      audioDurationMs: row._sum.audioDurationMs ?? 0,
      providerDurationMs: row._sum.providerDurationMs ?? 0,
      providerCostUsd: money(row._sum.providerCostUsd),
    };
  });

  const byPurpose = byPurposeRows.map((row) => {
    const statuses = byPurposeStatusRows.filter((item) => item.purpose === row.purpose);
    return {
      purpose: row.purpose,
      requestCount: row._count._all,
      successCount: statusCount(statuses, "SUCCESS"),
      failedCount: statusCount(statuses, "FAILED"),
      startedCount: statusCount(statuses, "STARTED"),
      audioDurationMs: row._sum.audioDurationMs ?? 0,
      providerDurationMs: row._sum.providerDurationMs ?? 0,
      providerCostUsd: money(row._sum.providerCostUsd),
    };
  });

  const response = NextResponse.json({
    generatedAt: now.toISOString(),
    period: { from: from.toISOString(), to: to.toISOString() },
    filters: { userEmail: userEmail ?? null, meetingId: meetingId ?? null, purpose: purpose ?? null },
    totals: {
      requestCount,
      successCount: statusCount(statusRows, "SUCCESS"),
      failedCount: statusCount(statusRows, "FAILED"),
      startedCount: statusCount(statusRows, "STARTED"),
      inputBytes: totals._sum.inputBytes ?? 0,
      audioDurationMs: totals._sum.audioDurationMs ?? 0,
      providerDurationMs: totals._sum.providerDurationMs ?? 0,
      providerCostUsd: money(totals._sum.providerCostUsd),
      costReportedRequests,
    },
    byUser,
    byPurpose,
    events: includeEvents
      ? recentEvents.map((event) => ({
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
          providerCostUsd: event.providerCostUsd === null ? null : Number(event.providerCostUsd),
          detectedLanguage: event.detectedLanguage,
          errorMessage: event.errorMessage,
          startedAt: event.startedAt.toISOString(),
          completedAt: event.completedAt?.toISOString() ?? null,
        }))
      : undefined,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
