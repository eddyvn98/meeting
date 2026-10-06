import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeMeetingBotSession } from "@/lib/meeting/bot/serialize";
import type { MeetingBotStatus } from "@/lib/meeting/bot/types";
import { isBotRunnerRequest, runnerId } from "../_auth";
import { applyMockComplete } from "@/lib/meeting/processing/applyMockComplete";

export const runtime = "nodejs";

const REQUEUEABLE_STATUSES: MeetingBotStatus[] = ["CLAIMED", "JOINING", "LOBBY", "JOINED"];
const DEFAULT_LEASE_TIMEOUT_MS = 120_000;
const DEFAULT_CAPTURE_LEASE_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_START_GRACE_MS = 60_000;
const DEFAULT_MAX_CONTINUATIONS = 2;
const DEFAULT_SCHEDULE_LATE_GRACE_MS = 10 * 60_000;
const DEFAULT_CALENDAR_LATE_GRACE_MS = 10 * 60_000;
// A Meeting left in PROCESSING for longer than this (measured from its
// updatedAt, which finalize/route.ts always bumps when it flips the status)
// never got a terminal signal from either the local-STT processing effect
// or scripts/meeting-bot-runner.mjs's own bounded wait — most likely the
// browser tab/process that was supposed to drive it died. Recovered the
// same way the runner's own timeout recovers: force mock-complete so the
// meeting reaches a retryable terminal state instead of staying stuck.
const DEFAULT_PROCESSING_STALE_MS = 2 * 60 * 60_000;

function envDuration(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function POST(req: NextRequest) {
  if (!isBotRunnerRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const staleBefore = new Date(now.getTime() - envDuration("MEETING_BOT_LEASE_TIMEOUT_MS", DEFAULT_LEASE_TIMEOUT_MS));
  const staleCaptureBefore = new Date(
    now.getTime() - envDuration("MEETING_BOT_CAPTURE_LEASE_TIMEOUT_MS", DEFAULT_CAPTURE_LEASE_TIMEOUT_MS),
  );
  const claimBefore = new Date(now.getTime() + envDuration("MEETING_BOT_START_GRACE_MS", DEFAULT_START_GRACE_MS));
  const scheduleLateBefore = new Date(
    now.getTime() - envDuration("MEETING_BOT_SCHEDULE_LATE_GRACE_MS", DEFAULT_SCHEDULE_LATE_GRACE_MS),
  );
  const calendarLateBefore = new Date(
    now.getTime() - envDuration("MEETING_BOT_CALENDAR_LATE_GRACE_MS", DEFAULT_CALENDAR_LATE_GRACE_MS),
  );

  await prisma.meetingBotSession.updateMany({
    where: {
      source: "SCHEDULE",
      status: "REQUESTED",
      scheduledAt: { not: null, lt: scheduleLateBefore },
    },
    data: {
      status: "FAILED",
      endedAt: now,
      errorMessage: "The scheduled start was missed while no runner capacity was available.",
    },
  });

  await prisma.meetingBotSession.updateMany({
    where: {
      source: "CALENDAR",
      status: "REQUESTED",
      scheduledAt: { not: null, lt: calendarLateBefore },
    },
    data: {
      status: "FAILED",
      endedAt: now,
      errorMessage: "The calendar meeting start was missed while the bot was unavailable.",
    },
  });

  await prisma.meetingBotSession.updateMany({
    where: { status: { in: REQUEUEABLE_STATUSES }, lastHeartbeatAt: { not: null, lt: staleBefore } },
    data: {
      status: "REQUESTED",
      runnerId: null,
      lastHeartbeatAt: null,
      startedAt: null,
      endedAt: null,
      errorMessage: "The previous runner lease expired; the session was requeued.",
    },
  });

  const staleCaptureSessions = await prisma.meetingBotSession.findMany({
    where: { status: "CAPTURING", lastHeartbeatAt: { not: null, lt: staleCaptureBefore } },
    select: {
      id: true,
      meetingId: true,
      ownerEmail: true,
      meetingUrl: true,
      title: true,
      source: true,
      sourceKey: true,
      attendeeEmails: true,
    },
  });
  if (staleCaptureSessions.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const session of staleCaptureSessions) {
        const failed = await tx.meetingBotSession.updateMany({
          where: { id: session.id, status: "CAPTURING", lastHeartbeatAt: { not: null, lt: staleCaptureBefore } },
          data: { status: "FAILED", runnerId: null, endedAt: now, errorMessage: "The runner heartbeat expired during capture." },
        });
        if (failed.count === 1) {
          if (session.meetingId) {
            await tx.meeting.updateMany({
              where: { id: session.meetingId, status: "UPLOADING" },
              data: { status: "FAILED", failureReason: "The meeting bot stopped reporting while recording." },
            });
          }

          const maxContinuationsRaw = Number(process.env.MEETING_BOT_MAX_CONTINUATIONS);
          const maxContinuations =
            Number.isInteger(maxContinuationsRaw) && maxContinuationsRaw >= 0
              ? maxContinuationsRaw
              : DEFAULT_MAX_CONTINUATIONS;
          const depth = (session.sourceKey?.match(/:continuation:/g) ?? []).length;
          if (depth < maxContinuations) {
            const baseKey = session.sourceKey ?? session.id;
            const continuationKey = `${baseKey}:continuation:${session.id}`;
            await tx.meetingBotSession.upsert({
              where: {
                source_sourceKey: {
                  source: session.source,
                  sourceKey: continuationKey,
                },
              },
              update: {},
              create: {
                ownerEmail: session.ownerEmail,
                meetingUrl: session.meetingUrl,
                title: session.title,
                source: session.source,
                sourceKey: continuationKey,
                scheduledAt: null,
                attendeeEmails: session.attendeeEmails,
                errorMessage: "Automatic continuation after the previous runner stopped during capture.",
              },
            });
          }
        }
      }
    });
  }

  await prisma.meetingBotSession.updateMany({
    where: { status: "STOP_REQUESTED", lastHeartbeatAt: { not: null, lt: staleBefore } },
    data: { status: "FAILED", runnerId: null, endedAt: now, errorMessage: "The runner stopped before finalizing the recording." },
  });

  await recoverStaleProcessingMeetings(now);

  const candidate = await prisma.meetingBotSession.findFirst({
    where: {
      status: "REQUESTED",
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: claimBefore } }],
    },
    orderBy: { requestedAt: "asc" },
  });
  if (!candidate) return new NextResponse(null, { status: 204 });

  const claimed = await prisma.meetingBotSession.updateMany({
    where: {
      id: candidate.id,
      status: "REQUESTED",
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: claimBefore } }],
    },
    data: { status: "CLAIMED", runnerId: runnerId(req), lastHeartbeatAt: new Date() },
  });
  if (claimed.count !== 1) return new NextResponse(null, { status: 204 });

  const session = await prisma.meetingBotSession.findUniqueOrThrow({ where: { id: candidate.id } });
  return NextResponse.json(serializeMeetingBotSession(session));
}

/**
 * Recovery for a Meeting stuck in PROCESSING with nothing left to drive it
 * forward — the mirror image of scripts/meeting-bot-runner.mjs's own
 * processing-wait timeout, for the cases that timeout can't cover: a
 * manually recorded/uploaded meeting (no bot session at all), or a bot
 * session whose runner process died between finalize and its own timeout
 * firing. Runs on every claim poll (best-effort, never blocks claiming),
 * override the deadline with MEETING_PROCESSING_STALE_MS.
 */
async function recoverStaleProcessingMeetings(now: Date): Promise<void> {
  const staleMs = envDuration("MEETING_PROCESSING_STALE_MS", DEFAULT_PROCESSING_STALE_MS);
  const staleBefore = new Date(now.getTime() - staleMs);
  const staleMeetings = await prisma.meeting.findMany({
    where: { status: "PROCESSING", updatedAt: { lt: staleBefore } },
  });
  for (const meeting of staleMeetings) {
    await applyMockComplete(meeting).catch((err) => {
      console.error(`[meeting] recoverStaleProcessingMeetings failed for ${meeting.id}:`, err instanceof Error ? err.message : err);
    });
  }
}
