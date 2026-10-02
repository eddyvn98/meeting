import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { serializeMeetingBotSchedule } from "@/lib/meeting/bot/serializeSchedule";
import {
  isMeetingScheduleRepeat,
  nextMeetingScheduleAtOrAfter,
} from "@/lib/meeting/bot/recurrence";
import { cleanMeetingTitle, normalizeTeamsMeetingUrl } from "@/lib/meeting/bot/teamsUrl";

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
  const nextRepeat = body.repeat === undefined ? schedule.repeat : body.repeat;
  const nextEnabled = body.enabled === undefined ? schedule.enabled : body.enabled === true;

  const now = new Date();
  if (nextRepeat === "NONE" && nextStart.getTime() < now.getTime() - 5 * 60_000 && nextEnabled) {
    return NextResponse.json({ error: "A one-time meeting cannot be enabled with a past start time." }, { status: 400 });
  }

  const timingChanged =
    parsedStart !== undefined ||
    body.repeat !== undefined ||
    body.enabled !== undefined;

  const nextRunAt = !nextEnabled
    ? null
    : timingChanged
      ? nextMeetingScheduleAtOrAfter(nextStart, nextRepeat, new Date(now.getTime() - 60_000))
      : schedule.nextRunAt;

  if (timingChanged) {
    await prisma.meetingBotSession.deleteMany({
      where: {
        source: "SCHEDULE",
        sourceKey: { startsWith: `${schedule.id}:` },
        status: "REQUESTED",
      },
    });
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

  const result = await prisma.meetingBotSchedule.deleteMany({
    where: { id: schedule.id, ownerEmail: email },
  });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ deleted: result.count });
}
