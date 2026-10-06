import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../_auth";
import { serializeMeetingBotSession } from "@/lib/meeting/bot/serialize";
import type { MeetingBotStatus } from "@/lib/meeting/bot/types";
import { maybePruneTerminalBotSessions } from "@/lib/meeting/bot/pruneBotSessions";
import { parseBotScheduledAt } from "@/lib/meeting/bot/schedule";
import {
  cleanMeetingTitle,
  normalizeTeamsMeetingUrl,
  teamsMeetingIdentity,
} from "@/lib/meeting/bot/teamsUrl";

const ACTIVE_STATUSES: MeetingBotStatus[] = [
  "REQUESTED",
  "CLAIMED",
  "JOINING",
  "LOBBY",
  "JOINED",
  "CAPTURING",
  "STOP_REQUESTED",
];

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

  const normalizedMeetingUrl = normalizeTeamsMeetingUrl(body.meetingUrl);
  if (!normalizedMeetingUrl) {
    return NextResponse.json({ error: "A valid Microsoft Teams meeting URL is required." }, { status: 400 });
  }

  const parsedSchedule = parseBotScheduledAt(body.scheduledAt);
  if (!parsedSchedule.ok) {
    return NextResponse.json({ error: parsedSchedule.error }, { status: 400 });
  }

  const meetingIdentity = teamsMeetingIdentity(normalizedMeetingUrl);
  if (!meetingIdentity) {
    return NextResponse.json({ error: "A valid Microsoft Teams meeting URL is required." }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`meeting-bot:${meetingIdentity}`}))`;
    const candidates = await tx.meetingBotSession.findMany({
      where: { status: { in: ACTIVE_STATUSES } },
      orderBy: { createdAt: "desc" }
    });
    const existing = candidates.find(
      (session) => teamsMeetingIdentity(session.meetingUrl) === meetingIdentity,
    );
    if (existing) {
      return {
        kind: existing.ownerEmail.toLowerCase() === email ? "owned-existing" as const : "foreign-existing" as const,
        session: existing,
      };
    }

    const session = await tx.meetingBotSession.create({
      data: {
        ownerEmail: email,
        meetingUrl: normalizedMeetingUrl,
        title: cleanMeetingTitle(body.title),
        scheduledAt: parsedSchedule.scheduledAt,
      },
    });
    return { kind: "created" as const, session };
  });

  if (result.kind === "foreign-existing") {
    return NextResponse.json(
      { error: "A meeting bot is already active or queued for this Teams meeting." },
      { status: 409 },
    );
  }
  return NextResponse.json(
    serializeMeetingBotSession(result.session),
    { status: result.kind === "created" ? 201 : 200 },
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
