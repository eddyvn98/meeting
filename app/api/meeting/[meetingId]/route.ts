import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../_auth";
import { resolveMeetingAccess } from "../_access";
import {
  serializeMeeting,
  serializeSpeaker,
  serializeSpeakerMapping,
  serializeTranscriptSegment,
  serializeBookmark,
  serializeMeetingSummary,
} from "@/lib/meeting/serialize";
import type { MeetingDetail } from "@/lib/meeting/types";
import { deleteMeetingAudioDir } from "@/lib/meeting/audio/cleanupMeetingAudio";

/** GET /api/meeting/[meetingId] — the full Meeting Result screen payload:
 *  meeting header fields, transcript (with speaker names resolved), speaker
 *  list + rename overlay, bookmarks, and the AI summary (topics, decisions,
 *  action items, blockers, open questions). Available to the owner AND
 *  anyone with an active (unrevoked, unexpired) MeetingShare grant — see
 *  _access.ts; `accessRole` in the response tells the UI whether to show
 *  owner-only affordances (rename, delete, share management). */
export async function GET(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  const accessRole = meeting ? await resolveMeetingAccess(meeting, email) : null;
  if (!meeting || !accessRole) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [speakers, speakerMappings, segments, bookmarks, summary, botSession] = await Promise.all([
    prisma.speaker.findMany({ where: { meetingId: meeting.id }, orderBy: { createdAt: "asc" } }),
    prisma.speakerMapping.findMany({ where: { meetingId: meeting.id } }),
    prisma.transcriptSegment.findMany({ where: { meetingId: meeting.id }, orderBy: { order: "asc" } }),
    prisma.bookmark.findMany({ where: { meetingId: meeting.id }, orderBy: { timestampMs: "asc" } }),
    prisma.meetingSummary.findUnique({
      where: { meetingId: meeting.id },
      include: { topics: true, decisions: true, actionItems: true, blockers: true, openQuestions: true, sections: { orderBy: { order: "asc" } } },
    }),
    prisma.meetingBotSession.findUnique({
      where: { meetingId: meeting.id },
      select: { participantNames: true, status: true },
    }),
  ]);

  const mappingsByKey = new Map(speakerMappings.map((m) => [m.speakerKey, m.displayName]));

  const detail: MeetingDetail = {
    ...serializeMeeting(meeting),
    participantNames: botSession?.participantNames ?? [],
    isLive: botSession?.status === "CAPTURING",
    speakers: speakers.map(serializeSpeaker),
    speakerMappings: speakerMappings.map(serializeSpeakerMapping),
    transcriptSegments: segments.map((s) => serializeTranscriptSegment(s, mappingsByKey)),
    bookmarks: bookmarks.map(serializeBookmark),
    summary: summary ? serializeMeetingSummary(summary) : null,
    accessRole,
  };
  return NextResponse.json(detail);
}

/** DELETE /api/meeting/[meetingId] — owner-only. Cascades to every child
 *  table via onDelete: Cascade in prisma/schema.prisma, and also removes the
 *  meeting's on-disk audio directory (data/meeting-audio/[id]/) — deleting
 *  a meeting used to leave its recorded audio behind forever, one of the
 *  disk-accumulation gaps cleanupMeetingAudio.ts closes. */
export async function DELETE(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const activeBotSession = await prisma.meetingBotSession.findUnique({
    where: { meetingId: meeting.id },
    select: { status: true },
  });
  if (
    activeBotSession &&
    ["CLAIMED", "JOINING", "LOBBY", "JOINED", "CAPTURING", "STOP_REQUESTED"].includes(activeBotSession.status)
  ) {
    return NextResponse.json(
      {
        error: "This meeting is still controlled by the meeting bot. Stop the bot and wait for recording finalization before deleting it.",
        code: "MEETING_BOT_ACTIVE",
      },
      { status: 409 },
    );
  }

  await prisma.meeting.delete({ where: { id: params.meetingId } });
  await deleteMeetingAudioDir(params.meetingId);
  return NextResponse.json({ ok: true });
}

/** PATCH /api/meeting/[meetingId] — title changes stay owner-only, while
 *  sidebar folder placement is personal to the current caller. Owners update
 *  Meeting.groupId; recipients of an active share update MeetingShare.groupId,
 *  so organizing a shared meeting never changes the owner's sidebar. */
export async function PATCH(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isOwner = meeting.ownerEmail.toLowerCase() === email.toLowerCase();
  const now = new Date();
  const activeShare = isOwner
    ? null
    : await prisma.meetingShare.findFirst({
        where: {
          meetingId: meeting.id,
          invitedEmail: { equals: email, mode: "insensitive" },
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });
  if (!isOwner && !activeShare) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { title?: unknown; groupId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.title === undefined && body.groupId === undefined) {
    return NextResponse.json({ error: "title or groupId is required" }, { status: 400 });
  }

  let groupId: string | null | undefined;
  if (body.groupId !== undefined) {
    if (body.groupId === null) {
      groupId = null;
    } else if (typeof body.groupId === "string") {
      const group = await prisma.meetingGroup.findUnique({ where: { id: body.groupId } });
      if (!group || group.ownerEmail.toLowerCase() !== email.toLowerCase()) {
        return NextResponse.json({ error: "Group not found" }, { status: 404 });
      }
      groupId = group.id;
    } else {
      return NextResponse.json({ error: "groupId must be a string or null" }, { status: 400 });
    }
  }

  if (!isOwner) {
    // Shared viewers/editors may organize the meeting in their own folders,
    // but may not rename or otherwise mutate the owner's Meeting row.
    if (body.title !== undefined) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (groupId === undefined || !activeShare) {
      return NextResponse.json({ error: "groupId is required" }, { status: 400 });
    }
    await prisma.meetingShare.update({ where: { id: activeShare.id }, data: { groupId } });
    return NextResponse.json({ ...serializeMeeting(meeting), groupId });
  }

  const data: { title?: string; groupId?: string | null } = {};
  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
    data.title = title;
  }
  if (groupId !== undefined) data.groupId = groupId;

  const updated = await prisma.meeting.update({ where: { id: params.meetingId }, data });
  return NextResponse.json(serializeMeeting(updated));
}
