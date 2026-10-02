import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyShareInvite } from "@/lib/meeting/notify";
import { resolveMeetingCallerEmail } from "../../_auth";
import { isKnownMeetingUserEmail, normalizeMeetingEmail } from "@/lib/meeting/identity";
import type { MeetingShare } from "@/lib/meeting/types";
import type { MeetingShareRole } from "@/lib/meeting/shareTypes";
import type { MeetingShareRole as PrismaMeetingShareRole } from "@prisma/client";

function serializeShare(row: {
  id: string;
  meetingId: string;
  invitedEmail: string;
  invitedBy: string;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  role: PrismaMeetingShareRole;
}): MeetingShare {
  return {
    id: row.id,
    meetingId: row.meetingId,
    invitedEmail: row.invitedEmail,
    invitedBy: row.invitedBy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    role: row.role === "EDITOR" ? "editor" : "viewer",
  };
}

function toPrismaRole(role: MeetingShareRole): PrismaMeetingShareRole {
  return role === "editor" ? "EDITOR" : "VIEWER";
}

/** GET /api/meeting/[meetingId]/shares — owner-only: every grant ever made
 *  (including revoked/expired ones, so the dialog can show share history,
 *  not just active grants) for the Share dialog's list. */
export async function GET(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const shares = await prisma.meetingShare.findMany({
    where: { meetingId: meeting.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(shares.map(serializeShare));
}

/** POST /api/meeting/[meetingId]/shares — owner-only: invite (or re-invite,
 *  if the same email was previously revoked) a company email with a
 *  viewer/editor role. Re-inviting an existing, still-active grant just
 *  updates its role/expiry (upsert on the (meetingId, invitedEmail) unique
 *  constraint) rather than erroring — the dialog treats "add" as
 *  idempotent, same as changing the role of an existing collaborator. */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { email?: unknown; role?: unknown; expiresAt?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const invitedEmail = normalizeMeetingEmail(typeof body.email === "string" ? body.email : null);
  if (!invitedEmail) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }
  if (invitedEmail === meeting.ownerEmail.toLowerCase()) {
    return NextResponse.json({ error: "This meeting's owner already has access" }, { status: 400 });
  }
  const rawRole = typeof body.role === "string" ? body.role.toLowerCase() : "viewer";
  if (rawRole !== "viewer" && rawRole !== "editor") {
    return NextResponse.json({ error: "role must be viewer or editor" }, { status: 400 });
  }
  // No pending-invite flow exists: an address that cannot sign in would
  // become a share row nobody can ever use — same rule POST
  // /api/workspaces/[id]/shares uses.
  if (!isKnownMeetingUserEmail(invitedEmail)) {
    return NextResponse.json(
      {
        error: "user_not_found",
        message: "This person must sign up for an account before they can be invited.",
      },
      { status: 422 },
    );
  }

  let expiresAt: Date | null = null;
  if (typeof body.expiresAt === "string" && body.expiresAt) {
    const parsed = new Date(body.expiresAt);
    if (Number.isNaN(parsed.getTime())) return NextResponse.json({ error: "Invalid expiresAt" }, { status: 400 });
    expiresAt = parsed;
  }

  const role = toPrismaRole(rawRole);
  const before = await prisma.meetingShare.findUnique({ where: { meetingId_invitedEmail: { meetingId: meeting.id, invitedEmail } } });
  const wasActive = Boolean(before && !before.revokedAt && (!before.expiresAt || before.expiresAt.getTime() > Date.now()));
  const share = await prisma.meetingShare.upsert({
    where: { meetingId_invitedEmail: { meetingId: meeting.id, invitedEmail } },
    create: { meetingId: meeting.id, invitedEmail, invitedBy: email, expiresAt, role },
    // Re-inviting clears a prior revoke and applies the new role/expiry —
    // the dialog's "add" action is the same as "re-enable" for a returning
    // email.
    update: { expiresAt, revokedAt: null, invitedBy: email, role },
  });
  // Only a new or re-enabled grant is news; a role/expiry change is not.
  if (!wasActive) await notifyShareInvite(meeting, invitedEmail, email, rawRole);
  return NextResponse.json(serializeShare(share), { status: 201 });
}
