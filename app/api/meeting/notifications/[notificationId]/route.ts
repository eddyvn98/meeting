import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";

/** PATCH /api/meeting/notifications/[id] — `{ read }`. Recipient-only; anyone
 *  else gets 404 so another person's notification is never confirmed to exist. */
export async function PATCH(req: NextRequest, { params }: { params: { notificationId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.meetingNotification.findUnique({ where: { id: params.notificationId } });
  if (!existing || existing.recipientEmail.toLowerCase() !== email.toLowerCase()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload = (await req.json().catch(() => null)) as { read?: unknown } | null;
  if (typeof payload?.read !== "boolean") return NextResponse.json({ error: "read (boolean) required" }, { status: 400 });
  const updated = await prisma.meetingNotification.update({ where: { id: existing.id }, data: { read: payload.read } });
  return NextResponse.json(updated);
}

/** DELETE /api/meeting/notifications/[id] — recipient-only, like PATCH. */
export async function DELETE(req: NextRequest, { params }: { params: { notificationId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.meetingNotification.findUnique({ where: { id: params.notificationId } });
  if (!existing || existing.recipientEmail.toLowerCase() !== email.toLowerCase()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.meetingNotification.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
