import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { serializeMeetingBotSchedule } from "@/lib/meeting/bot/serializeSchedule";
import {
  isMeetingScheduleRepeat,
  nextMeetingScheduleAtOrAfter,
} from "@/lib/meeting/bot/recurrence";
import { cleanMeetingTitle, normalizeTeamsMeetingUrl } from "@/lib/meeting/bot/teamsUrl";
import { meetingBotScheduleLockKey } from "@/lib/meeting/bot/scheduleLock";

const ACTIVE_BOT_STATUSES = ["CLAIMED", "JOINING", "LOBBY", "JOINED", "CAPTURING"] as const;

function parseOptionalDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

type PatchBody = {
  meetingUrl?: unknown;
  title?: unknown;
  startAt?: unknown;
  repeat?: unknown;
  enabled?: unknown;
  timezoneOffsetMin?: unknown;
};

type MutationResult =
  | { kind: "ok"; schedule: Awaited<ReturnType<typeof prisma.meetingBotSchedule.findUniqueOrThrow>> }
  | { kind: "error"; status: number; error: string };

export async function PATCH(
  req: NextRequest,
  { params }: { params: { scheduleId: string } },
) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx): Promise<MutationResult> => {
    // Dispatch, edit and delete share this per-schedule lock. Once a user
    // action succeeds, a waiting dispatcher must re-read the updated schedule
    // and cannot resurrect the superseded occurrence.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${meetingBotScheduleLockKey(params.scheduleId)}))`;

    const schedule = await tx.meetingBotSchedule.findUnique({ where: { id: params.scheduleId } });
    if (!schedule || schedule.ownerEmail.toLowerCase() !== email) {
      return { kind: "error", status: 404, error: "Not found" };
    }

    const nextUrl = body.meetingUrl === undefined
      ? schedule.meetingUrl
      : normalizeTeamsMeetingUrl(body.meetingUrl);
    if (!nextUrl) {
      return { kind: "error", status: 400, error: "A valid Microsoft Teams meeting URL is required." };
    }

    const parsedStart = parseOptionalDate(body.startAt);
    if (parsedStart === null) {
      return { kind: "error", status: 400, error: "A valid meeting start time is required." };
    }
    const nextStart = parsedStart ?? schedule.startAt;

    if (body.repeat !== undefined && !isMeetingScheduleRepeat(body.repeat)) {
      return { kind: "error", status: 400, error: "Invalid repeat rule." };
    }
    const nextRepeat = body.repeat === undefined
      ? schedule.repeat
      : isMeetingScheduleRepeat(body.repeat)
        ? body.repeat
        : schedule.repeat;
    const nextEnabled = body.enabled === undefined ? schedule.enabled : body.enabled === true;
    const nextTimezoneOffsetMin = body.timezoneOffsetMin === undefined
      ? schedule.timezoneOffsetMin
      : typeof body.timezoneOffsetMin === "number" &&
          Number.isInteger(body.timezoneOffsetMin) &&
          body.timezoneOffsetMin >= -840 &&
          body.timezoneOffsetMin <= 840
        ? body.timezoneOffsetMin
        : null;
    if (nextTimezoneOffsetMin === null) {
      return { kind: "error", status: 400, error: "Invalid timezone offset." };
    }

    const now = new Date();
    if (nextRepeat === "NONE" && nextStart.getTime() < now.getTime() - 5 * 60_000 && nextEnabled) {
      return { kind: "error", status: 400, error: "A one-time meeting cannot be enabled with a past start time." };
    }

    const timingChanged =
      nextStart.getTime() !== schedule.startAt.getTime() ||
      nextRepeat !== schedule.repeat ||
      nextEnabled !== schedule.enabled ||
      nextTimezoneOffsetMin !== schedule.timezoneOffsetMin;

    const nextRunAt = !nextEnabled
      ? null
      : timingChanged
        ? nextMeetingScheduleAtOrAfter(
            nextStart,
            nextRepeat,
            new Date(now.getTime() - 60_000),
            nextTimezoneOffsetMin,
          )
        : schedule.nextRunAt;

    if (timingChanged) {
      await tx.meetingBotSession.deleteMany({
        where: {
          source: "SCHEDULE",
          sourceKey: { startsWith: `${schedule.id}:` },
          status: "REQUESTED",
        },
      });
      const stopActive =
        body.enabled === false ||
        parsedStart !== undefined ||
        body.meetingUrl !== undefined;
      if (stopActive) {
        await tx.meetingBotSession.updateMany({
          where: {
            source: "SCHEDULE",
            sourceKey: { startsWith: `${schedule.id}:` },
            status: { in: [...ACTIVE_BOT_STATUSES] },
          },
          data: {
            status: "STOP_REQUESTED",
            lastHeartbeatAt: new Date(),
            errorMessage: "The internal meeting schedule was changed or disabled.",
          },
        });
      }
    } else if (body.meetingUrl !== undefined || body.title !== undefined) {
      await tx.meetingBotSession.updateMany({
        where: {
          source: "SCHEDULE",
          sourceKey: { startsWith: `${schedule.id}:` },
          status: "REQUESTED",
        },
        data: {
          meetingUrl: nextUrl,
          title: body.title === undefined ? schedule.title : cleanMeetingTitle(body.title),
        },
      });
    }

    const updated = await tx.meetingBotSchedule.update({
      where: { id: schedule.id },
      data: {
        meetingUrl: nextUrl,
        title: body.title === undefined ? schedule.title : cleanMeetingTitle(body.title),
        startAt: nextStart,
        timezoneOffsetMin: nextTimezoneOffsetMin,
        repeat: nextRepeat,
        enabled: nextEnabled && nextRunAt !== null,
        nextRunAt,
      },
    });

    return { kind: "ok", schedule: updated };
  });

  if (result.kind === "error") {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(serializeMeetingBotSchedule(result.schedule));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { scheduleId: string } },
) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${meetingBotScheduleLockKey(params.scheduleId)}))`;

    const schedule = await tx.meetingBotSchedule.findUnique({ where: { id: params.scheduleId } });
    if (!schedule || schedule.ownerEmail.toLowerCase() !== email) return false;

    await tx.meetingBotSession.deleteMany({
      where: {
        source: "SCHEDULE",
        sourceKey: { startsWith: `${schedule.id}:` },
        status: "REQUESTED",
      },
    });
    await tx.meetingBotSession.updateMany({
      where: {
        source: "SCHEDULE",
        sourceKey: { startsWith: `${schedule.id}:` },
        status: { in: [...ACTIVE_BOT_STATUSES] },
      },
      data: {
        status: "STOP_REQUESTED",
        lastHeartbeatAt: new Date(),
        errorMessage: "The internal meeting schedule was deleted.",
      },
    });

    const deleted = await tx.meetingBotSchedule.deleteMany({
      where: { id: schedule.id, ownerEmail: email },
    });
    return deleted.count === 1;
  });

  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ deleted: 1 });
}
