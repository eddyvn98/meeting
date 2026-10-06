import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../_auth";
import { serializeMeetingBotSession } from "@/lib/meeting/bot/serialize";
import type { MeetingBotStatus } from "@/lib/meeting/bot/types";
import { maybePruneTerminalBotSessions } from "@/lib/meeting/bot/pruneBotSessions";
import { parseBotScheduledAt } from "@/lib/meeting/bot/schedule";

const ACTIVE_STATUSES: MeetingBotStatus[] = [
  "REQUESTED",
  "CLAIMED",
  "JOINING",
  "LOBBY",
  "JOINED",
  "CAPTURING",
  "STOP_REQUESTED",
];

function normalizeTeamsMeetingUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const isTeamsHost = url.protocol === "https:" && [
      "teams.microsoft.com",
      "teams.live.com",
      "teams.cloud.microsoft",
    ].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
    if (!isTeamsHost) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function serializeTitle(value: unknown): string {
  if (typeof value !== "string") return "Teams Meeting";
  const title = value.trim().replace(/\s+/g, " ");
  return title.slice(0, 180) || "Teams Meeting";
}

export async function GET(req: NextRequest) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  maybePruneTerminalBotSessions(email);

  const sessions = await prisma.meetingBotSession.findMany({
    where: { ownerEmail: email },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return NextResponse.json(sessions.map(serializeMeetingBotSession));
}

export async function POST(req: NextRequest) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { meetingUrl?: unknown; title?: unknown; scheduledAt?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const meetingUrl = typeof body.meetingUrl === "string" ? body.meetingUrl.trim() : "";
  const normalizedMeetingUrl = normalizeTeamsMeetingUrl(meetingUrl);
  if (!normalizedMeetingUrl) {
    return NextResponse.json({ error: "A valid Microsoft Teams meeting URL is required." }, { status: 400 });
  }

  const parsedSchedule = parseBotScheduledAt(body.scheduledAt);
  if (!parsedSchedule.ok) {
    return NextResponse.json({ error: parsedSchedule.error }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    // The UI can double-submit and two browser tabs can enqueue the same URL
    // at the same time. Serialize the read+create pair so both callers get
    // the same active session instead of creating two bots for one meeting.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`meeting-bot-manual:${email}:${normalizedMeetingUrl}`}))`;

    const existing = await tx.meetingBotSession.findFirst({
      where: { ownerEmail: email, meetingUrl: normalizedMeetingUrl, status: { in: ACTIVE_STATUSES } },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return { session: existing, created: false };

    const session = await tx.meetingBotSession.create({
      data: {
        ownerEmail: email,
        meetingUrl: normalizedMeetingUrl,
        title: serializeTitle(body.title),
        scheduledAt: parsedSchedule.scheduledAt,
      },
    });
    return { session, created: true };
  });

  return NextResponse.json(
    serializeMeetingBotSession(result.session),
    { status: result.created ? 201 : 200 },
  );
}

/** Clears every finished session for the caller; active sessions are never touched. */
export async function DELETE(req: NextRequest) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await prisma.meetingBotSession.deleteMany({
    where: { ownerEmail: email, status: { in: ["ENDED", "FAILED"] } },
  });
  return NextResponse.json({ deleted: result.count });
}
