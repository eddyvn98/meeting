import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isBotRunnerRequest } from "../../bot-sessions/_auth";
import { nextMeetingScheduleRun } from "@/lib/meeting/bot/recurrence";

export const runtime = "nodejs";

const DEFAULT_START_GRACE_MS = 60_000;

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
      const sourceKey = `${schedule.id}:${occurrence.toISOString()}`;

      await tx.meetingBotSession.upsert({
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

      const nextRunAt = nextMeetingScheduleRun(schedule.startAt, schedule.repeat, occurrence);
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
