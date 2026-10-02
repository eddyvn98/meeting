import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../_auth";
import { serializeMeetingGroup } from "@/lib/meeting/serialize";
import type { CreateMeetingGroupInput } from "@/lib/meeting/types";

/** GET /api/meeting/groups — the caller's own sidebar folders, in manual
 *  order (MeetingAside.tsx). Owner-scoped only — groups are never shared. */
export async function GET(req: NextRequest) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const groups = await prisma.meetingGroup.findMany({
    where: { ownerEmail: { equals: email, mode: "insensitive" } },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(groups.map(serializeMeetingGroup));
}

/** POST /api/meeting/groups — creates a new sidebar folder. `order` is set
 *  to the current Unix time in SECONDS (order is a 32-bit int column — a
 *  millisecond timestamp overflows it) so a new group always sorts after
 *  existing ones without a separate reorder step. */
export async function POST(req: NextRequest) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Partial<CreateMeetingGroupInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const group = await prisma.meetingGroup.create({
    data: { ownerEmail: email, name, order: Math.floor(Date.now() / 1000) },
  });
  return NextResponse.json(serializeMeetingGroup(group), { status: 201 });
}
