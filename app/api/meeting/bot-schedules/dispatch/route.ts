import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isBotRunnerRequest } from "../../bot-sessions/_auth";
import {
  nextMeetingScheduleAtOrAfter,
  nextMeetingScheduleRun,
} from "@/lib/meeting/bot/recurrence";
import { sameBotOccurrence } from "@/lib/meeting/bot/sessionKeys";

export const runtime = "nodejs";

const DEFAULT_START_GRACE_MS = 60_000;
const DEFAULT_LATE_GRACE_MS = 10 * 60_000;

function envDuration(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function POST(req: NextRequest) {
  if (!isBotRunnerRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const dispatchBefore = new Date(
    now.getTime() + envDuration("MEETING_BOT_START_GRACE_MS", DEFAULT_START_GRACE_MS),
  );
  const staleBefore = new Date(
    now.getTime() - envDuration("MEETING_BOT_SCHEDULE_LATE_GRACE_MS", DEFAULT_LATE_GRACE_MS),
  );

  const due = await prisma.meetingBotSchedule.findMany({
    where: {
      enabled: true,
      nextRunAt: { not: null, lte: dispatchBefore },
    },
    orderBy: { nextRunAt: "asc" },
    take: 25,
  });

  let dispatched = 0;

  for (const candidate of due) {
    await prisma.$transaction(async (tx) => {
      const schedule = await tx.meetingBotSchedule.findUnique({ where: { id: candidate.id } });
      if (!schedule?.enabled || !schedule.nextRunAt || schedule.nextRunAt > dispatchBefore) return;

      const occurrence = schedule.nextRunAt;

      if (occurrence < staleBefore) {
        const nextRunAt = nextMeetingScheduleAtOrAfter(
          schedule.startAt,
          schedule.repeat,
          now,
          schedule.timezoneOffsetMin,
        );
        await tx.meetingBotSchedule.updateMany({
          where: { id: schedule.id, enabled: true, nextRunAt: occurrence },
          data: { nextRunAt, enabled: nextRunAt !== null },
        });
        return;
      }

      const sourceKey = `${schedule.id}:${occurrence.toISOString()}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`meeting-bot:${schedule.meetingUrl}`}))`;

      const conflict = await tx.meetingBotSession.findFirst({
        where: {
          meetingUrl: schedule.meetingUrl,
          status: { not: "FAILED" },
          NOT: {
            source: "SCHEDULE",
            sourceKey: { startsWith: `${schedule.id}:` },
          },
          scheduledAt: {
            gte: new Date(occurrence.getTime() - 10 * 60_000),
            lte: new Date(occurrence.getTime() + 10 * 60_000),
          },
        },
        orderBy: { requestedAt: "asc" },
      });

      let continuationConflict = null;
      if (!conflict) {
        const continuations = await tx.meetingBotSession.findMany({
          where: {
            meetingUrl: schedule.meetingUrl,
            status: { not: "FAILED" },
            scheduledAt: null,
            sourceKey: { contains: ":continuation:" },
            NOT: {
              source: "SCHEDULE",
              sourceKey: { startsWith: `${schedule.id}:` },
            },
          },
          orderBy: { requestedAt: "desc" },
          take: 50,
        });
        continuationConflict = continuations.find((session) =>
          sameBotOccurrence(session.sourceKey, occurrence),
        ) ?? null;
      }

      if (!conflict && !continuationConflict) await tx.meetingBotSession.upsert({
        where: {
          source_sourceKey: {
            source: "SCHEDULE",
            sourceKey,
          },
        },
        update: {},
        create: {
          ownerEmail: schedule.ownerEmail,
          meetingUrl: schedule.meetingUrl,
          title: schedule.title,
          source: "SCHEDULE",
          sourceKey,
          scheduledAt: occurrence,
        },
      });

      const nextRunAt = nextMeetingScheduleRun(
        schedule.startAt,
        schedule.repeat,
        occurrence,
        schedule.timezoneOffsetMin,
      );
      const advanced = await tx.meetingBotSchedule.updateMany({
        where: {
          id: schedule.id,
          enabled: true,
          nextRunAt: occurrence,
        },
        data: {
          lastTriggeredAt: occurrence,
          nextRunAt,
          enabled: nextRunAt !== null,
        },
      });
      if (advanced.count === 1) dispatched += 1;
    });
  }

  return NextResponse.json({ dispatched });
}
