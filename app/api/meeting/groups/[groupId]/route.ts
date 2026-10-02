import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { serializeMeeting, serializeMeetingGroup } from "@/lib/meeting/serialize";
import type { UpdateMeetingGroupInput } from "@/lib/meeting/types";

/** GET /api/meeting/groups/[groupId] — the group itself plus the caller's
 *  own meetings filed under it (newest first), for the group's page (list +
 *  "Ask across this group"). Owner-only, same as every other group action. */
export async function GET(req: NextRequest, { params }: { params: { groupId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = await prisma.meetingGroup.findUnique({ where: { id: params.groupId } });
  if (!group || group.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meetings = await prisma.meeting.findMany({
    where: { groupId: group.id, ownerEmail: { equals: email, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    group: serializeMeetingGroup(group),
    meetings: meetings.map(serializeMeeting),
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

/** DELETE /api/meeting/groups/[groupId] — removes the folder only. Its
 *  meetings are never deleted: Meeting.groupId's onDelete: SetNull
 *  (prisma/schema.prisma) un-files them back to the plain Recent list. */
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
