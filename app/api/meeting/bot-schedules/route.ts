import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../_auth";
import { serializeMeetingBotSchedule } from "@/lib/meeting/bot/serializeSchedule";
import {
  isMeetingScheduleRepeat,
  nextMeetingScheduleAtOrAfter,
} from "@/lib/meeting/bot/recurrence";
import { cleanMeetingTitle, normalizeTeamsMeetingUrl } from "@/lib/meeting/bot/teamsUrl";

function parseStartAt(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export async function GET(req: NextRequest) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const schedules = await prisma.meetingBotSchedule.findMany({
    where: { ownerEmail: email },
    orderBy: [{ enabled: "desc" }, { nextRunAt: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
  return NextResponse.json(schedules.map(serializeMeetingBotSchedule));
}

export async function POST(req: NextRequest) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const meetingUrl = normalizeTeamsMeetingUrl(body.meetingUrl);
  const startAt = parseStartAt(body.startAt);
  const repeat = isMeetingScheduleRepeat(body.repeat) ? body.repeat : "NONE";
  const enabled = body.enabled !== false;
  const timezoneOffsetMin =
    typeof body.timezoneOffsetMin === "number" &&
    Number.isInteger(body.timezoneOffsetMin) &&
    body.timezoneOffsetMin >= -840 &&
    body.timezoneOffsetMin <= 840
      ? body.timezoneOffsetMin
      : 0;

  if (!meetingUrl) {
    return NextResponse.json({ error: "A valid Microsoft Teams meeting URL is required." }, { status: 400 });
  }
  if (!startAt) {
    return NextResponse.json({ error: "A valid meeting start time is required." }, { status: 400 });
  }

  const now = new Date();
  if (repeat === "NONE" && startAt.getTime() < now.getTime() - 5 * 60_000) {
    return NextResponse.json({ error: "A one-time meeting cannot be scheduled in the past." }, { status: 400 });
  }

  const nextRunAt = enabled
    ? nextMeetingScheduleAtOrAfter(startAt, repeat, new Date(now.getTime() - 60_000), timezoneOffsetMin)
    : null;

  const result = await prisma.$transaction(async (tx) => {
    const lockKey = [
      "meeting-bot-schedule",
      email,
      meetingUrl,
      startAt.toISOString(),
      repeat,
    ].join(":");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const existing = await tx.meetingBotSchedule.findFirst({
      where: {
        ownerEmail: email,
        meetingUrl,
        startAt,
        repeat,
        enabled: true,
      },
    });
    if (existing) return { schedule: existing, created: false };

    const schedule = await tx.meetingBotSchedule.create({
      data: {
        ownerEmail: email,
        meetingUrl,
        title: cleanMeetingTitle(body.title),
        startAt,
        timezoneOffsetMin,
        nextRunAt,
        repeat,
        enabled: enabled && nextRunAt !== null,
      },
    });
    return { schedule, created: true };
  });

  return NextResponse.json(
    serializeMeetingBotSchedule(result.schedule),
    { status: result.created ? 201 : 200 },
  );
}
