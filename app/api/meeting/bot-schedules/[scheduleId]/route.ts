import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { serializeMeetingBotSchedule } from "@/lib/meeting/bot/serializeSchedule";
import {
  isMeetingScheduleRepeat,
  nextMeetingScheduleAtOrAfter,
} from "@/lib/meeting/bot/recurrence";
import { cleanMeetingTitle, normalizeTeamsMeetingUrl } from "@/lib/meeting/bot/teamsUrl";

const ACTIVE_BOT_STATUSES = ["CLAIMED", "JOINING", "LOBBY", "JOINED", "CAPTURING"] as const;

function parseOptionalDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { scheduleId: string } },
) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const schedule = await prisma.meetingBotSchedule.findUnique({ where: { id: params.scheduleId } });
  if (!schedule || schedule.ownerEmail.toLowerCase() !== email) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: {
    meetingUrl?: unknown;
    title?: unknown;
    startAt?: unknown;
    repeat?: unknown;
    enabled?: unknown;
    timezoneOffsetMin?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const nextUrl = body.meetingUrl === undefined
    ? schedule.meetingUrl
    : normalizeTeamsMeetingUrl(body.meetingUrl);
  if (!nextUrl) {
    return NextResponse.json({ error: "A valid Microsoft Teams meeting URL is required." }, { status: 400 });
  }

  const parsedStart = parseOptionalDate(body.startAt);
  if (parsedStart === null) {
    return NextResponse.json({ error: "A valid meeting start time is required." }, { status: 400 });
  }
  const nextStart = parsedStart ?? schedule.startAt;

  if (body.repeat !== undefined && !isMeetingScheduleRepeat(body.repeat)) {
    return NextResponse.json({ error: "Invalid repeat rule." }, { status: 400 });
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
    return NextResponse.json({ error: "Invalid timezone offset." }, { status: 400 });
  }

  const now = new Date();
  if (nextRepeat === "NONE" && nextStart.getTime() < now.getTime() - 5 * 60_000 && nextEnabled) {
    return NextResponse.json({ error: "A one-time meeting cannot be enabled with a past start time." }, { status: 400 });
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
    await prisma.meetingBotSession.deleteMany({
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
      await prisma.meetingBotSession.updateMany({
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
    await prisma.meetingBotSession.updateMany({
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

  const updated = await prisma.meetingBotSchedule.update({
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

  return NextResponse.json(serializeMeetingBotSchedule(updated));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { scheduleId: string } },
) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const schedule = await prisma.meetingBotSchedule.findFirst({
    where: { id: params.scheduleId, ownerEmail: email },
  });
  if (!schedule) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.meetingBotSession.deleteMany({
    where: {
      source: "SCHEDULE",
      sourceKey: { startsWith: `${schedule.id}:` },
      status: "REQUESTED",
    },
  });
  await prisma.meetingBotSession.updateMany({
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

  const result = await prisma.meetingBotSchedule.deleteMany({
    where: { id: schedule.id, ownerEmail: email },
  });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ deleted: result.count });
}
