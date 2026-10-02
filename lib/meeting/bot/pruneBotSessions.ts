/**
 * lib/meeting/bot/pruneBotSessions.ts
 *
 * Retention sweep for MeetingBotSession rows: a session in a terminal
 * status (ENDED/FAILED) whose last update is older than the retention
 * window is deleted. This is purely a bot-session-history cleanup —
 * MeetingBotSession.meetingId -> Meeting is `onDelete: SetNull` on the
 * MeetingBotSession side, so deleting a bot session row never cascades to
 * the Meeting it was linked to, nor to any transcript/audio/summary
 * belonging to that meeting. Only rows in ACTIVE statuses are ever
 * excluded from deletion by construction (the where clause only matches
 * TERMINAL_STATUSES).
 *
 * Triggers (see maybeRunScheduledCleanup below and its call site in
 * GET /api/meeting/bot-sessions/route.ts, plus the terminal-transition
 * call in [sessionId]/events/route.ts): opportunistic, throttled, and
 * best-effort — a failed sweep never blocks the request that triggered it.
 */

import { prisma } from "@/lib/prisma";
import type { MeetingBotStatus } from "./types";

/** Terminal statuses eligible for pruning. Kept in sync with
 *  MeetingBotPanel.tsx's TERMINAL_STATUSES — never includes an active
 *  status, so an in-progress session is never a candidate. */
export const TERMINAL_STATUSES: readonly MeetingBotStatus[] = ["ENDED", "FAILED"];

/** How long a terminal bot session stays around before the sweep deletes
 *  it. Override with MEETING_BOT_SESSION_RETENTION_DAYS (positive integer;
 *  an invalid or non-positive value falls back to the default). */
export const BOT_SESSION_RETENTION_DAYS = resolveRetentionDays(process.env.MEETING_BOT_SESSION_RETENTION_DAYS);

function resolveRetentionDays(raw: string | undefined): number {
  const DEFAULT_DAYS = 30;
  if (!raw) return DEFAULT_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return DEFAULT_DAYS;
  return parsed;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Cutoff date: rows whose `updatedAt` (covers endedAt in practice, since
 *  the events route always bumps updatedAt when it sets endedAt) is
 *  strictly before this are prune candidates. */
export function computeCutoff(olderThanDays: number, now: Date): Date {
  return new Date(now.getTime() - olderThanDays * MS_PER_DAY);
}

export interface PruneTerminalBotSessionsOptions {
  /** Restrict the sweep to one owner. Omit to sweep every owner. */
  ownerEmail?: string;
  olderThanDays?: number;
  now?: Date;
}

/** Deletes terminal (ENDED/FAILED) MeetingBotSession rows older than the
 *  retention window. Never touches a row in an active status — the status
 *  filter is always scoped to TERMINAL_STATUSES regardless of caller
 *  input. Returns the number of rows deleted. */
export async function pruneTerminalBotSessions(options: PruneTerminalBotSessionsOptions = {}): Promise<number> {
  const olderThanDays = options.olderThanDays ?? BOT_SESSION_RETENTION_DAYS;
  const now = options.now ?? new Date();
  const cutoff = computeCutoff(olderThanDays, now);

  const result = await prisma.meetingBotSession.deleteMany({
    where: {
      ...(options.ownerEmail ? { ownerEmail: options.ownerEmail } : {}),
      status: { in: [...TERMINAL_STATUSES] },
      updatedAt: { lt: cutoff },
    },
  });
  return result.count;
}

const THROTTLE_INTERVAL_MS = 60 * 60 * 1000; // once per owner per hour
const lastSweepAtByOwner = new Map<string, number>();

/** Opportunistic per-owner throttle, mirroring
 *  lib/meeting/audio/cleanupMeetingAudio.ts's maybeRunScheduledCleanup.
 *  Fire-and-forget: never awaited by the caller, and any failure is
 *  logged and swallowed so it can never fail the request that triggered
 *  it. */
export function maybePruneTerminalBotSessions(ownerEmail: string): void {
  const key = ownerEmail.toLowerCase();
  const now = Date.now();
  const last = lastSweepAtByOwner.get(key) ?? 0;
  if (now - last < THROTTLE_INTERVAL_MS) return;
  lastSweepAtByOwner.set(key, now);
  void pruneTerminalBotSessions({ ownerEmail }).catch((err) => {
    console.warn("[meeting] maybePruneTerminalBotSessions failed:", err instanceof Error ? err.message : String(err));
  });
}
