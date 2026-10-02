import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isBotRunnerRequest } from "../_auth";
import { cleanMeetingTitle, normalizeTeamsMeetingUrl } from "@/lib/meeting/bot/teamsUrl";

export const runtime = "nodejs";

const ACTIVE = ["CLAIMED", "JOINING", "LOBBY", "JOINED", "CAPTURING"] as const;
const MAX_EVENTS = 1000;

function canonicalEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function cleanKey(value: unknown, max = 512): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  return key && key.length <= max ? key : null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function sourceKey(mailboxKey: string, eventId: string, scheduledAt: Date): string {
  return `graph:${mailboxKey}:${eventId}:${scheduledAt.toISOString()}`;
}

type SyncEvent = {
  eventId?: unknown;
  meetingUrl?: unknown;
  title?: unknown;
  scheduledAt?: unknown;
  ownerEmail?: unknown;
  organizerEmail?: unknown;
  organizerAllowed?: unknown;
  invited?: unknown;
  cancelled?: unknown;
  declined?: unknown;
};

export async function POST(req: NextRequest) {
  if (!isBotRunnerRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    mailboxKey?: unknown;
    botEmail?: unknown;
    windowStart?: unknown;
    windowEnd?: unknown;
    events?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mailboxKey = cleanKey(body.mailboxKey, 240);
  const botEmail = canonicalEmail(body.botEmail);
  const windowStart = parseDate(body.windowStart);
  const windowEnd = parseDate(body.windowEnd);
  const events = Array.isArray(body.events) ? body.events as SyncEvent[] : null;

  if (!mailboxKey || !botEmail || !windowStart || !windowEnd || !events) {
    return NextResponse.json({ error: "mailboxKey, botEmail, windowStart, windowEnd, and events are required." }, { status: 400 });
  }
  if (windowEnd <= windowStart) {
    return NextResponse.json({ error: "Calendar sync window is invalid." }, { status: 400 });
  }
  if (events.length > MAX_EVENTS) {
    return NextResponse.json({ error: `Calendar sync is limited to ${MAX_EVENTS} events per snapshot.` }, { status: 400 });
  }

  const prefix = `graph:${mailboxKey}:`;
  const seen = new Set<string>();
  const stats = {
    created: 0,
    updated: 0,
    removed: 0,
    stopRequested: 0,
    ignored: 0,
    blockedOrganizer: 0,
    notInvited: 0,
  };

  // Pre-v2 Graph discovery stored the raw event id as sourceKey. Remove only
  // still-pending legacy rows inside this snapshot window so upgrading cannot
  // queue both the legacy row and the new immutable mailbox-scoped occurrence.
  const legacyQueued = await prisma.meetingBotSession.findMany({
    where: {
      source: "CALENDAR",
      status: "REQUESTED",
      scheduledAt: { gte: windowStart, lt: windowEnd },
    },
    select: { id: true, sourceKey: true },
  });
  const legacyIds = legacyQueued
    .filter((session) => !session.sourceKey?.startsWith("graph:"))
    .map((session) => session.id);
  if (legacyIds.length) {
    const deleted = await prisma.meetingBotSession.deleteMany({
      where: { id: { in: legacyIds }, status: "REQUESTED" },
    });
    stats.removed += deleted.count;
  }

  for (const item of events) {
    const eventId = cleanKey(item.eventId);
    const scheduledAt = parseDate(item.scheduledAt);
    if (!eventId || !scheduledAt) {
      stats.ignored += 1;
      continue;
    }

    const key = sourceKey(mailboxKey, eventId, scheduledAt);
    seen.add(key);

    const meetingUrl = normalizeTeamsMeetingUrl(item.meetingUrl);
    const ownerEmail = canonicalEmail(item.ownerEmail);
    const organizerAllowed = item.organizerAllowed === true;
    const invited = item.invited === true;
    const unavailable =
      item.cancelled === true ||
      item.declined === true ||
      !meetingUrl ||
      !ownerEmail ||
      !organizerAllowed ||
      !invited;

    if (!organizerAllowed) stats.blockedOrganizer += 1;
    if (!invited) stats.notInvited += 1;

    const existing = await prisma.meetingBotSession.findUnique({
      where: { source_sourceKey: { source: "CALENDAR", sourceKey: key } },
    });

    if (unavailable) {
      if (!existing) {
        stats.ignored += 1;
      } else if (existing.status === "REQUESTED") {
        await prisma.meetingBotSession.delete({ where: { id: existing.id } });
        stats.removed += 1;
      } else if (ACTIVE.includes(existing.status as (typeof ACTIVE)[number])) {
        await prisma.meetingBotSession.update({
          where: { id: existing.id },
          data: {
            status: "STOP_REQUESTED",
            lastHeartbeatAt: new Date(),
            errorMessage: item.cancelled === true
              ? "The Outlook calendar event was cancelled."
              : item.declined === true
                ? "The calendar invitation was declined."
                : !organizerAllowed
                ? "The meeting organizer is not allowed to invite the bot."
                : !invited
                  ? "The bot mailbox is not an attendee of this meeting."
                  : "The calendar event no longer has a Teams join URL.",
          },
        });
        stats.stopRequested += 1;
      }
      continue;
    }

    await prisma.meetingBotSession.upsert({
      where: { source_sourceKey: { source: "CALENDAR", sourceKey: key } },
      update: {
        ownerEmail,
        meetingUrl,
        title: cleanMeetingTitle(item.title),
        scheduledAt,
        ...(existing?.status === "REQUESTED" ? { errorMessage: null } : {}),
      },
      create: {
        ownerEmail,
        meetingUrl,
        title: cleanMeetingTitle(item.title),
        source: "CALENDAR",
        sourceKey: key,
        scheduledAt,
      },
    });
    if (existing) stats.updated += 1;
    else stats.created += 1;
  }

  const queued = await prisma.meetingBotSession.findMany({
    where: {
      source: "CALENDAR",
      sourceKey: { startsWith: prefix },
      status: { in: ["REQUESTED", ...ACTIVE] },
      scheduledAt: { gte: windowStart, lt: windowEnd },
    },
    select: { id: true, sourceKey: true, status: true },
  });

  for (const session of queued) {
    if (!session.sourceKey || seen.has(session.sourceKey)) continue;
    if (session.status === "REQUESTED") {
      await prisma.meetingBotSession.delete({ where: { id: session.id } });
      stats.removed += 1;
    } else {
      await prisma.meetingBotSession.update({
        where: { id: session.id },
        data: {
          status: "STOP_REQUESTED",
          lastHeartbeatAt: new Date(),
          errorMessage: "The Outlook calendar event was removed or rescheduled.",
        },
      });
      stats.stopRequested += 1;
    }
  }

  return NextResponse.json(stats);
}
