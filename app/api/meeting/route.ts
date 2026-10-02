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

/** GET /api/meeting — the caller's own meetings PLUS any meeting shared with
 *  them via an active (unrevoked, unexpired) MeetingShare grant — newest
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

  const sharedMeetingIds = (
    await prisma.meetingShare.findMany({
      where: {
        invitedEmail: { equals: email, mode: "insensitive" },
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { meetingId: true },
    })
  ).map((s) => s.meetingId);

  const where: Prisma.MeetingWhereInput = {
    OR: [{ ownerEmail: { equals: email, mode: "insensitive" } }, { id: { in: sharedMeetingIds } }],
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

  const [meetings, activeShareMeetingIds] = await Promise.all([
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
  ]);
  const ownedAndShared = new Set(activeShareMeetingIds.map((s) => s.meetingId));
  const sharedWithMeSet = new Set(sharedMeetingIds);

  return NextResponse.json(
    meetings.map((m) => ({
      ...serializeMeeting(m),
      isShared: ownedAndShared.has(m.id) || sharedWithMeSet.has(m.id),
      sharedWithMe: sharedWithMeSet.has(m.id),
    })),
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
