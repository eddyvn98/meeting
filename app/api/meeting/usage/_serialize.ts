import { Prisma } from "@prisma/client";

type SttUsageEvent = Prisma.MeetingSttUsageGetPayload<{
  include: { meeting: { select: { title: true } } };
}>;
type AiUsageEvent = Prisma.MeetingAiUsageGetPayload<Record<string, never>>;

export function decimal(value: Prisma.Decimal | null | undefined): number {
  return value == null ? 0 : Number(value);
}

export function pricesFor(
  rows: Array<{ currency: string | null; _sum: { totalPrice: Prisma.Decimal | null } }>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    if (row.currency) result[row.currency] = decimal(row._sum.totalPrice);
  }
  return result;
}

export function tokenGroups<
  T extends {
    _count: { _all: number };
    _sum: {
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
    };
  },
>(rows: T[]) {
  return rows.map(({ _count, _sum, ...group }) => ({
    ...group,
    requestCount: _count._all,
    inputTokens: _sum.inputTokens ?? 0,
    outputTokens: _sum.outputTokens ?? 0,
    totalTokens: _sum.totalTokens ?? 0,
  }));
}

export function serializeSttEvent(event: SttUsageEvent) {
  return {
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
  };
}

export function serializeAiEvent(event: AiUsageEvent) {
  return {
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
  };
}
