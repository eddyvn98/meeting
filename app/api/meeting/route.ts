import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "./_auth";
import { serializeMeeting } from "@/lib/meeting/serialize";
import type { CreateMeetingInput, MeetingStatus } from "@/lib/meeting/types";
import { maybeRunScheduledCleanup } from "@/lib/meeting/audio/cleanupMeetingAudio";
import { MAX_UPLOAD_FILE_SIZE_BYTES } from "@/lib/meeting/recorder/fileUploadPipeline";
import { DEFAULT_STT_LANG, isValidSttLang } from "@/lib/meeting/sttLanguages";

const VALID_STATUSES: MeetingStatus[] = ["UPLOADING", "PROCESSING", "READY", "FAILED"];

/** GET /api/meeting — the caller's own meetings PLUS calendar-backed Teams
 *  rooms where they are an attendee PLUS explicit active MeetingShare grants — newest
 *  first, for the Home screen's "Recent Meetings" list, the left sidebar's
 *  Recent list, and the "Meetings" nav page. No nested transcript/summary
 *  payload — see GET /api/meeting/[meetingId] for that.
 *
 *  Optional query params (sidebar search, MeetingAside.tsx):
 *    - `q`: case-insensitive match against the title OR any transcript
 *      segment's text (English or Vietnamese) — lets a search find a meeting
 *      by something that was actually said, not just its title.
 *    - `date`: an ISO "YYYY-MM-DD" — only meetings created that calendar day
 *      (server-local time). */
export async function GET(req: NextRequest) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  maybeRunScheduledCleanup();

  const q = req.nextUrl.searchParams.get("q")?.trim();
  const dateParam = req.nextUrl.searchParams.get("date")?.trim();
  const now = new Date();
  const callerEmail = email.trim().toLowerCase();

  const activeShares = await prisma.meetingShare.findMany({
    where: {
      invitedEmail: { equals: email, mode: "insensitive" },
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { meetingId: true, groupId: true },
  });
  const sharedMeetingIds = activeShares.map((s) => s.meetingId);
  const sharedGroupByMeeting = new Map(activeShares.map((s) => [s.meetingId, s.groupId]));

  // A calendar attendee is a natural member of the Teams room. The bot
  // session is linked to the Meeting as soon as capture starts, so the live
  // Meeting appears in every attendee's list without creating MeetingShare
  // rows or making the inviter special.
  const attendeeSessions = await prisma.meetingBotSession.findMany({
    where: { meetingId: { not: null }, attendeeEmails: { has: callerEmail } },
    select: { meetingId: true },
  });
  const attendeeMeetingIds = attendeeSessions.flatMap((session) => session.meetingId ? [session.meetingId] : []);
  const attendeeMeetingIdSet = new Set(attendeeMeetingIds);
  const accessibleMeetingIds = [...new Set([...sharedMeetingIds, ...attendeeMeetingIds])];

  const where: Prisma.MeetingWhereInput = {
    OR: [{ ownerEmail: { equals: email, mode: "insensitive" } }, { id: { in: accessibleMeetingIds } }],
  };

  if (q) {
    where.AND = [
      {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { transcriptSegments: { some: { OR: [{ textEn: { contains: q, mode: "insensitive" } }, { textVi: { contains: q, mode: "insensitive" } }] } } },
        ],
      },
    ];
  }

  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const start = new Date(`${dateParam}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    where.createdAt = { gte: start, lt: end };
  }

  const [meetings, activeShareMeetingIds, liveBotSessions] = await Promise.all([
    prisma.meeting.findMany({ where, orderBy: { createdAt: "desc" } }),
    // Which of the caller's OWN meetings have at least one active share out
    // — powers the sidebar's "shared" icon for the owner's side too.
    prisma.meetingShare.findMany({
      where: {
        meeting: { ownerEmail: { equals: email, mode: "insensitive" } },
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { meetingId: true },
      distinct: ["meetingId"],
    }),
    prisma.meetingBotSession.findMany({
      where: { status: "CAPTURING", meetingId: { not: null } },
      select: { meetingId: true },
    }),
  ]);
  const liveMeetingIds = new Set(liveBotSessions.flatMap((session) => session.meetingId ? [session.meetingId] : []));
  const ownedAndShared = new Set(activeShareMeetingIds.map((s) => s.meetingId));
  const sharedWithMeSet = new Set(
    meetings
      .filter((m) =>
        m.ownerEmail.toLowerCase() !== callerEmail &&
        (sharedGroupByMeeting.has(m.id) || attendeeMeetingIdSet.has(m.id))
      )
      .map((m) => m.id),
  );

  return NextResponse.json(
    meetings.map((m) => {
      const sharedWithMe = sharedWithMeSet.has(m.id);
      const attendeeOnlyAccess =
        m.ownerEmail.toLowerCase() !== callerEmail &&
        attendeeMeetingIdSet.has(m.id) &&
        !sharedGroupByMeeting.has(m.id);
      return {
        ...serializeMeeting(m),
        // A shared recipient's folder placement is personal. Never leak the
        // owner's Meeting.groupId into the recipient's sidebar.
        groupId: sharedWithMe ? (sharedGroupByMeeting.get(m.id) ?? null) : m.groupId,
        isShared: ownedAndShared.has(m.id) || sharedWithMe,
        isLive: liveMeetingIds.has(m.id),
        sharedWithMe,
        attendeeOnlyAccess,
      };
    }),
  );
}

/** POST /api/meeting — creates a meeting record. This is the minimal
 *  "register a meeting row" surface the recording/upload pipeline (a
 *  separate build step) writes to before it starts pushing audio chunks;
 *  it does not itself accept audio bytes or trigger STT. */
export async function POST(req: NextRequest) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Partial<CreateMeetingInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: `status must be one of ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }
  // Mirrors fileUploadPipeline.ts's client-side FileTooLargeError check —
  // enforced again here since a client-side check alone can be bypassed
  // (e.g. a direct API call), and this is the earliest point the eventual
  // file size is known, before any chunk bytes are actually uploaded.
  if (typeof body.fileSizeBytes === "number" && body.fileSizeBytes > MAX_UPLOAD_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `fileSizeBytes exceeds the ${MAX_UPLOAD_FILE_SIZE_BYTES} byte upload limit` },
      { status: 413 },
    );
  }

  const meeting = await prisma.meeting.create({
    data: {
      ownerEmail: email,
      title: body.title.trim(),
      status: body.status ?? "UPLOADING",
      audioUrl: asOptionalString(body.audioUrl),
      durationSec: asOptionalInt(body.durationSec),
      fileSizeBytes: asOptionalInt(body.fileSizeBytes),
      mimeType: asOptionalString(body.mimeType),
      sttLanguage: typeof body.sttLanguage === "string" && isValidSttLang(body.sttLanguage) ? body.sttLanguage : DEFAULT_STT_LANG,
    },
  });
  return NextResponse.json(serializeMeeting(meeting), { status: 201 });
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asOptionalInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
}
