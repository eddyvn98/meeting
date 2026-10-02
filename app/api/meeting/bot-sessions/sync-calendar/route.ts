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
  cancelled?: unknown;
  declined?: unknown;
};

export async function POST(req: NextRequest) {
  if (!isBotRunnerRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    mailboxKey?: unknown;
    ownerEmail?: unknown;
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
  const ownerEmail = canonicalEmail(body.ownerEmail);
  const windowStart = parseDate(body.windowStart);
  const windowEnd = parseDate(body.windowEnd);
  const events = Array.isArray(body.events) ? body.events as SyncEvent[] : null;

  if (!mailboxKey || !ownerEmail || !windowStart || !windowEnd || !events) {
    return NextResponse.json({ error: "mailboxKey, ownerEmail, windowStart, windowEnd, and events are required." }, { status: 400 });
  }
  if (windowEnd <= windowStart) {
    return NextResponse.json({ error: "Calendar sync window is invalid." }, { status: 400 });
  }
  if (events.length > MAX_EVENTS) {
    return NextResponse.json({ error: `Calendar sync is limited to ${MAX_EVENTS} events per snapshot.` }, { status: 400 });
  }

  const prefix = `graph:${mailboxKey}:`;
  const seen = new Set<string>();
  const stats = { created: 0, updated: 0, removed: 0, stopRequested: 0, ignored: 0 };

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
    const unavailable = item.cancelled === true || item.declined === true || !meetingUrl;

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
                : "The calendar event no longer has a Teams join URL.",
          },
        });
        stats.stopRequested += 1;
      }
      continue;
    }

    if (!existing) {
      await prisma.meetingBotSession.create({
        data: {
          ownerEmail,
          meetingUrl,
          title: cleanMeetingTitle(item.title),
          source: "CALENDAR",
          sourceKey: key,
          scheduledAt,
        },
      });
      stats.created += 1;
      continue;
    }

    if (existing.status === "REQUESTED") {
      await prisma.meetingBotSession.update({
        where: { id: existing.id },
        data: {
          ownerEmail,
          meetingUrl,
          title: cleanMeetingTitle(item.title),
          scheduledAt,
          errorMessage: null,
        },
      });
      stats.updated += 1;
    }
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
