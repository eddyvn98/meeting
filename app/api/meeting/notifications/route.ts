import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../_auth";

/** GET /api/meeting/notifications — the caller's 50 most recent Meeting
 *  notifications, newest first (the bell polls this). */
export async function GET(req: NextRequest) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const notifications = await prisma.meetingNotification.findMany({
    where: { recipientEmail: email },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(notifications);
}

/** POST /api/meeting/notifications — `{ action: "read-all" }` marks every
 *  notification of the caller as read. */
export async function POST(req: NextRequest) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = (await req.json().catch(() => null)) as { action?: unknown } | null;
  if (payload?.action !== "read-all") return NextResponse.json({ error: 'action must be "read-all"' }, { status: 400 });
  const result = await prisma.meetingNotification.updateMany({ where: { recipientEmail: email, read: false }, data: { read: true } });
  return NextResponse.json({ updated: result.count });
}

/** DELETE /api/meeting/notifications — clears every notification of the caller. */
export async function DELETE(req: NextRequest) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await prisma.meetingNotification.deleteMany({ where: { recipientEmail: email } });
  return NextResponse.json({ deleted: result.count });
}
