import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

export type DifyUsageApp = "meeting_processing" | "meeting_qa";

export interface DifyUsageContext {
  email: string;
  app: DifyUsageApp;
  feature: string;
  difyUrl: string;
  requestedModel?: string | null;
}

interface ParsedDifyUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalPrice?: number;
  currency?: string;
  latencyMs?: number;
  providerModel?: string;
  providerRequestId?: string;
  workflowRunId?: string;
}

type UsageStatus = "SUCCESS" | "FAILED" | "EMPTY" | "INVALID" | "ABORTED";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function positiveInt(value: unknown): number {
  const parsed = finiteNumber(value);
  return parsed && parsed > 0 ? Math.round(parsed) : 0;
}

function cleanString(value: unknown, max = 200): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

function usageCandidate(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload) ?? {};
  const data = asRecord(root.data);
  const metadata = asRecord(root.metadata);
  const dataMetadata = asRecord(data?.metadata);

  const candidates = [
    asRecord(metadata?.usage),
    asRecord(root.usage),
    asRecord(dataMetadata?.usage),
    asRecord(data?.usage),
    data,
  ].filter((value): value is Record<string, unknown> => Boolean(value));

  return candidates.find((candidate) =>
    ["prompt_tokens", "input_tokens", "completion_tokens", "output_tokens", "total_tokens", "total_price"]
      .some((key) => key in candidate),
  ) ?? {};
}

function firstString(records: Array<Record<string, unknown> | null>, keys: string[]): string | undefined {
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      const value = cleanString(record[key]);
      if (value) return value;
    }
  }
  return undefined;
}

export function parseDifyUsage(payload: unknown): ParsedDifyUsage {
  const root = asRecord(payload) ?? {};
  const data = asRecord(root.data);
  const metadata = asRecord(root.metadata);
  const usage = usageCandidate(payload);

  const inputTokens = positiveInt(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = positiveInt(usage.completion_tokens ?? usage.output_tokens);
  const explicitTotal = positiveInt(usage.total_tokens ?? data?.total_tokens);
  const totalTokens = explicitTotal || inputTokens + outputTokens;

  const totalPrice = finiteNumber(usage.total_price ?? data?.total_price);
  const currency = cleanString(usage.currency ?? data?.currency, 16);
  const latencySeconds = finiteNumber(usage.latency ?? data?.elapsed_time ?? root.elapsed_time);
  const latencyMs = latencySeconds === undefined ? undefined : Math.max(0, Math.round(latencySeconds * 1000));

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    totalPrice: totalPrice !== undefined && totalPrice >= 0 ? totalPrice : undefined,
    currency,
    latencyMs,
    providerModel: firstString([usage, metadata, data], ["model", "model_name", "llm_model"]),
    providerRequestId: firstString([root, data], ["message_id", "task_id", "request_id"]),
    workflowRunId: firstString([data, root], ["workflow_run_id", "id"]),
  };
}

export function requestedModelFromInputs(inputs: Record<string, unknown> | undefined): string | null {
  const model = inputs?.model_selector ?? inputs?.model ?? inputs?.model_id ?? inputs?.primary_model;
  return typeof model === "string" && model.trim() ? model.trim() : null;
}

export function meetingWorkflowApp(): DifyUsageApp {
  return "meeting_processing";
}

async function writeUsage(
  context: DifyUsageContext,
  attempt: number,
  status: UsageStatus,
  parsed: ParsedDifyUsage,
  options: { httpStatus?: number; errorMessage?: string; startedAt?: number } = {},
): Promise<void> {
  try {
    await prisma.meetingAiUsage.create({
      data: {
        requestId: randomUUID(),
        userEmail: context.email.trim().toLowerCase(),
        provider: "dify",
        app: context.app,
        feature: context.feature.slice(0, 80),
        attempt: Math.max(1, attempt),
        requestedModel: context.requestedModel?.slice(0, 160) || null,
        providerModel: parsed.providerModel ?? null,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        totalTokens: parsed.totalTokens,
        totalPrice: parsed.totalPrice ?? null,
        currency: parsed.currency ?? null,
        latencyMs: parsed.latencyMs ?? (options.startedAt ? Math.max(0, Date.now() - options.startedAt) : null),
        httpStatus: options.httpStatus ?? null,
        status,
        providerRequestId: parsed.providerRequestId ?? null,
        workflowRunId: parsed.workflowRunId ?? null,
        errorMessage: options.errorMessage?.slice(0, 2_000) || null,
      },
    });
  } catch (error) {
    console.warn("[meeting] Failed to persist Dify usage:", error instanceof Error ? error.message : String(error));
  }
}

export async function recordDifyBlockingResponse(
  context: DifyUsageContext,
  payload: unknown,
  attempt = 1,
  status: UsageStatus = "SUCCESS",
  httpStatus = 200,
  startedAt?: number,
): Promise<void> {
  await writeUsage(context, attempt, status, parseDifyUsage(payload), { httpStatus, startedAt });
}

export async function recordDifyFailure(
  context: DifyUsageContext,
  attempt: number,
  status: Exclude<UsageStatus, "SUCCESS">,
  error: unknown,
  httpStatus?: number,
  startedAt?: number,
): Promise<void> {
  await writeUsage(
    context,
    attempt,
    status,
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
    {
      httpStatus,
      startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
    },
  );
}

export function createUsageStreamObserver(context: DifyUsageContext, _contentType?: string, attempt = 1): {
  onEvent: (event: unknown) => void;
  finish: (status?: string) => Promise<void>;
} {
  const startedAt = Date.now();
  let best: ParsedDifyUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  return {
    onEvent(event: unknown) {
      const next = parseDifyUsage(event);
      if (next.totalTokens >= best.totalTokens || next.totalPrice !== undefined) {
        best = {
          ...best,
          ...next,
          inputTokens: Math.max(best.inputTokens, next.inputTokens),
          outputTokens: Math.max(best.outputTokens, next.outputTokens),
          totalTokens: Math.max(best.totalTokens, next.totalTokens),
        };
      }
    },
    async finish(status = "complete") {
      const normalized: UsageStatus =
        status === "complete" ? "SUCCESS"
          : status === "aborted" ? "ABORTED"
            : "FAILED";
      await writeUsage(context, attempt, normalized, best, { startedAt });
    },
  };
}
