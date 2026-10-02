import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { serializeMeeting, serializeMeetingGroup } from "@/lib/meeting/serialize";
import type { UpdateMeetingGroupInput } from "@/lib/meeting/types";

/** GET /api/meeting/groups/[groupId] — the caller's personal group,
 *  containing both owned meetings filed through Meeting.groupId and meetings
 *  shared with the caller that they filed through MeetingShare.groupId. */
export async function GET(req: NextRequest, { params }: { params: { groupId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = await prisma.meetingGroup.findUnique({ where: { id: params.groupId } });
  if (!group || group.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const now = new Date();
  const sharedPlacements = await prisma.meetingShare.findMany({
    where: {
      groupId: group.id,
      invitedEmail: { equals: email, mode: "insensitive" },
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { meetingId: true },
  });
  const sharedMeetingIds = sharedPlacements.map((s) => s.meetingId);
  const sharedSet = new Set(sharedMeetingIds);

  const meetings = await prisma.meeting.findMany({
    where: {
      OR: [
        { groupId: group.id, ownerEmail: { equals: email, mode: "insensitive" } },
        { id: { in: sharedMeetingIds } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    group: serializeMeetingGroup(group),
    meetings: meetings.map((meeting) => ({
      ...serializeMeeting(meeting),
      groupId: group.id,
      isShared: sharedSet.has(meeting.id),
      sharedWithMe: sharedSet.has(meeting.id) && meeting.ownerEmail.toLowerCase() !== email.toLowerCase(),
    })),
  });
}

/** PATCH /api/meeting/groups/[groupId] — rename only for now. */
export async function PATCH(req: NextRequest, { params }: { params: { groupId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = await prisma.meetingGroup.findUnique({ where: { id: params.groupId } });
  if (!group || group.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: Partial<UpdateMeetingGroupInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const updated = await prisma.meetingGroup.update({ where: { id: group.id }, data: { name } });
  return NextResponse.json(serializeMeetingGroup(updated));
}

/** DELETE /api/meeting/groups/[groupId] — removes the folder only. Owned
 *  Meeting.groupId and recipient MeetingShare.groupId references both use
 *  onDelete: SetNull, so deleting a personal folder never deletes meetings. */
export async function DELETE(req: NextRequest, { params }: { params: { groupId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = await prisma.meetingGroup.findUnique({ where: { id: params.groupId } });
  if (!group || group.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.meetingGroup.delete({ where: { id: group.id } });
  return NextResponse.json({ ok: true });
}
