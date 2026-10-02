import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../../_auth";

/** Shared owner-only lookup: resolves the caller and the share row, 404ing
 *  when either the meeting isn't owned by the caller or the share doesn't
 *  belong to it. Used by both PATCH and DELETE below. */
async function requireOwnedShare(req: NextRequest, meetingId: string, shareId: string) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return { ok: false as const, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  const share = await prisma.meetingShare.findUnique({ where: { id: shareId } });
  if (!share || share.meetingId !== meeting.id) {
    return { ok: false as const, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  return { ok: true as const, meeting, share };
}

/** PATCH /api/meeting/[meetingId]/shares/[shareId] — owner-only: change an
 *  existing grant's role (viewer <-> editor). Body: `{ role: "viewer" |
 *  "editor" }`. Mirrors PATCH .../sections/[sectionId]'s "only touch what's
 *  present" shape, but role is the only mutable field here — email/expiry
 *  changes go through POST .../shares (re-invite). */
export async function PATCH(req: NextRequest, { params }: { params: { meetingId: string; shareId: string } }) {
  const auth = await requireOwnedShare(req, params.meetingId, params.shareId);
  if (!auth.ok) return auth.response;

  let body: { role?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const role = typeof body.role === "string" ? body.role.toLowerCase() : "";
  if (role !== "viewer" && role !== "editor") {
    return NextResponse.json({ error: "role must be viewer or editor" }, { status: 400 });
  }

  const updated = await prisma.meetingShare.update({
    where: { id: params.shareId },
    data: { role: role === "editor" ? "EDITOR" : "VIEWER" },
  });
  return NextResponse.json({
    id: updated.id,
    meetingId: updated.meetingId,
    invitedEmail: updated.invitedEmail,
    invitedBy: updated.invitedBy,
    createdAt: updated.createdAt.toISOString(),
    expiresAt: updated.expiresAt ? updated.expiresAt.toISOString() : null,
    revokedAt: updated.revokedAt ? updated.revokedAt.toISOString() : null,
    role: updated.role === "EDITOR" ? "editor" : "viewer",
  });
}

/** DELETE /api/meeting/[meetingId]/shares/[shareId] — owner-only: revoke a
 *  grant. Sets `revokedAt` instead of deleting the row so the Share
 *  dialog's history (and _access.ts's "who had access when") survives the
 *  revoke — see MeetingShare's schema doc comment. Takes effect
 *  immediately: every route that checks access re-resolves it per request
 *  (resolveMeetingAccess / requireMeetingEditor), there is no cached role
 *  to invalidate. */
export async function DELETE(req: NextRequest, { params }: { params: { meetingId: string; shareId: string } }) {
  const auth = await requireOwnedShare(req, params.meetingId, params.shareId);
  if (!auth.ok) return auth.response;

  await prisma.meetingShare.update({ where: { id: params.shareId }, data: { revokedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
