import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";

async function loadOwnedMeeting(req: NextRequest, meetingId: string) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;
  }
  return { meeting } as const;
}

const payload = (m: { publicShareEnabled: boolean; publicShareToken: string | null }) => ({
  enabled: m.publicShareEnabled && Boolean(m.publicShareToken),
  token: m.publicShareToken,
});

/** GET — owner-only: current public-link state for the Share dialog. */
export async function GET(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const ctx = await loadOwnedMeeting(req, params.meetingId);
  if ("error" in ctx) return ctx.error;
  return NextResponse.json(payload(ctx.meeting));
}

/** POST — owner-only: enable the link (creating a token the first time).
 *  `{ rotate: true }` issues a new token, which invalidates the old link. */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const ctx = await loadOwnedMeeting(req, params.meetingId);
  if ("error" in ctx) return ctx.error;

  const body = (await req.json().catch(() => ({}))) as { rotate?: unknown };
  const token = body.rotate === true || !ctx.meeting.publicShareToken ? randomBytes(24).toString("base64url") : ctx.meeting.publicShareToken;
  const updated = await prisma.meeting.update({
    where: { id: ctx.meeting.id },
    data: { publicShareEnabled: true, publicShareToken: token },
  });
  return NextResponse.json(payload(updated));
}

/** DELETE — owner-only: turn the public link off (the token is kept so that
 *  re-enabling restores the same URL). */
export async function DELETE(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const ctx = await loadOwnedMeeting(req, params.meetingId);
  if ("error" in ctx) return ctx.error;
  const updated = await prisma.meeting.update({ where: { id: ctx.meeting.id }, data: { publicShareEnabled: false } });
  return NextResponse.json(payload(updated));
}
