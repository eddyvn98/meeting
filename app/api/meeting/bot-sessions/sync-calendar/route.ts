import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isBotRunnerRequest } from "../_auth";
import {
  cleanMeetingTitle,
  normalizeTeamsMeetingUrl,
  teamsMeetingIdentity,
} from "@/lib/meeting/bot/teamsUrl";
import {
  botSourceOccurrenceAt,
  rootBotSourceKey,
  sameBotOccurrence,
} from "@/lib/meeting/bot/sessionKeys";
import {
  cleanCalendarSyncKey,
  graphCalendarSourceKey,
  parseCalendarSyncDate,
  parseCalendarSyncPayload,
} from "@/lib/meeting/bot/calendarSyncPayload";
import {
  canonicalMeetingEmail,
  sanitizeMeetingAttendeeEmails,
} from "@/lib/meeting/bot/attendeeEmails";

export const runtime = "nodejs";

const ACTIVE = ["CLAIMED", "JOINING", "LOBBY", "JOINED", "CAPTURING"] as const;

export async function POST(req: NextRequest) {
  if (!isBotRunnerRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseCalendarSyncPayload(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { mailboxKey, windowStart, windowEnd, events } = parsed.payload;

  const prefix = `graph:${mailboxKey}:`;
  const seen = new Set<string>();
  const seenEventPrefixes = new Set<string>();
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
    const eventId = cleanCalendarSyncKey(item.eventId);
    const scheduledAt = parseCalendarSyncDate(item.scheduledAt);
    if (!eventId || !scheduledAt) {
      stats.ignored += 1;
      continue;
    }

    const key = graphCalendarSourceKey(mailboxKey, eventId, scheduledAt);
    const eventPrefix = `${prefix}${eventId}:`;
    seen.add(key);
    seenEventPrefixes.add(eventPrefix);

    const meetingUrl = normalizeTeamsMeetingUrl(item.meetingUrl);
    const ownerEmail = canonicalMeetingEmail(item.ownerEmail);
    const attendeeEmails = sanitizeMeetingAttendeeEmails(item.attendeeEmails);
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

    if (unavailable) {
      const affected = await prisma.meetingBotSession.findMany({
        where: {
          source: "CALENDAR",
          sourceKey: { startsWith: eventPrefix },
          status: { in: ["REQUESTED", ...ACTIVE] },
        },
        select: { id: true, status: true },
      });
      if (affected.length === 0) {
        stats.ignored += 1;
      }
      for (const session of affected) {
        if (session.status === "REQUESTED") {
          await prisma.meetingBotSession.delete({ where: { id: session.id } });
          stats.removed += 1;
        } else {
          await prisma.meetingBotSession.update({
            where: { id: session.id },
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
      }
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const meetingIdentity = teamsMeetingIdentity(meetingUrl) ?? meetingUrl;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`meeting-bot:${meetingIdentity}`}))`;

      const current = await tx.meetingBotSession.findUnique({
        where: { source_sourceKey: { source: "CALENDAR", sourceKey: key } },
      });
      if (current) {
        await tx.meetingBotSession.update({
          where: { id: current.id },
          data: {
            ownerEmail,
            meetingUrl,
            title: cleanMeetingTitle(item.title),
            scheduledAt,
            attendeeEmails,
            ...(current.status === "REQUESTED" ? { errorMessage: null } : {}),
          },
        });
        stats.updated += 1;
        return;
      }

      const superseded = await tx.meetingBotSession.findMany({
        where: {
          source: "CALENDAR",
          sourceKey: { startsWith: eventPrefix },
          status: { in: ["REQUESTED", ...ACTIVE] },
        },
        select: { id: true, status: true },
      });
      for (const prior of superseded) {
        if (prior.status === "REQUESTED") {
          await tx.meetingBotSession.delete({ where: { id: prior.id } });
          stats.removed += 1;
        } else {
          await tx.meetingBotSession.update({
            where: { id: prior.id },
            data: {
              status: "STOP_REQUESTED",
              lastHeartbeatAt: new Date(),
              errorMessage: "The Outlook calendar event was rescheduled.",
            },
          });
          stats.stopRequested += 1;
        }
      }

      const conflictCandidates = await tx.meetingBotSession.findMany({
        where: {
          status: { not: "FAILED" },
          NOT: {
            source: "CALENDAR",
            sourceKey: { startsWith: eventPrefix },
          },
          scheduledAt: {
            gte: new Date(scheduledAt.getTime() - 10 * 60_000),
            lte: new Date(scheduledAt.getTime() + 10 * 60_000),
          },
        },
        orderBy: { requestedAt: "asc" }
      });
      const conflict = conflictCandidates.find(
        (session) => teamsMeetingIdentity(session.meetingUrl) === meetingIdentity,
      ) ?? null;
      let continuationConflict = null;
      if (!conflict) {
        const continuations = await tx.meetingBotSession.findMany({
          where: {
            status: { not: "FAILED" },
            scheduledAt: null,
            sourceKey: { contains: ":continuation:" },
            NOT: {
              source: "CALENDAR",
              sourceKey: { startsWith: eventPrefix },
            },
          },
          orderBy: { requestedAt: "desc" }
        });
        continuationConflict = continuations.find((session) =>
          teamsMeetingIdentity(session.meetingUrl) === meetingIdentity &&
          sameBotOccurrence(session.sourceKey, scheduledAt),
        ) ?? null;
      }
      if (conflict || continuationConflict) {
        stats.ignored += 1;
        return;
      }

      await tx.meetingBotSession.create({
        data: {
          ownerEmail,
          meetingUrl,
          title: cleanMeetingTitle(item.title),
          source: "CALENDAR",
          sourceKey: key,
          scheduledAt,
          attendeeEmails,
        },
      });
      stats.created += 1;
    });
  }

  const queued = await prisma.meetingBotSession.findMany({
    where: {
      source: "CALENDAR",
      sourceKey: { startsWith: prefix },
      status: { in: ["REQUESTED", ...ACTIVE] },
    },
    select: { id: true, sourceKey: true, status: true, scheduledAt: true },
  });

  for (const session of queued) {
    const rootKey = rootBotSourceKey(session.sourceKey);
    if (!rootKey) continue;
    if (seen.has(rootKey)) continue;

    const occurrenceAt = session.scheduledAt ?? botSourceOccurrenceAt(session.sourceKey);
    if (!occurrenceAt || occurrenceAt < windowStart || occurrenceAt >= windowEnd) continue;

    const belongsToSeenEvent = [...seenEventPrefixes].some((eventPrefix) =>
      rootKey.startsWith(eventPrefix),
    );
    if (belongsToSeenEvent) continue;

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
