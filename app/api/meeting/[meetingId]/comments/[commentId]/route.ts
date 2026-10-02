import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../../_auth";
import { resolveMeetingAccess } from "../../../_access";

const MAX_COMMENT_LENGTH = 10_000;

async function loadContext(req: NextRequest, params: { meetingId: string; commentId: string }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  const role = meeting ? await resolveMeetingAccess(meeting, email) : null;
  const comment = role
    ? await prisma.meetingMinutesComment.findFirst({ where: { id: params.commentId, meetingId: params.meetingId } })
    : null;
  if (!meeting || !role || !comment) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;
  return { email, role, comment } as const;
}

/** PATCH — `{ resolved }` may be set by anyone with access; `{ body }` (edit)
 *  only by the comment's author. */
export async function PATCH(req: NextRequest, { params }: { params: { meetingId: string; commentId: string } }) {
  const ctx = await loadContext(req, params);
  if ("error" in ctx) return ctx.error;

  let payload: { resolved?: unknown; body?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: { resolved?: boolean; body?: string } = {};
  if (typeof payload.resolved === "boolean") data.resolved = payload.resolved;
  if (typeof payload.body === "string") {
    if (ctx.comment.authorEmail.toLowerCase() !== ctx.email.toLowerCase()) {
      return NextResponse.json({ error: "Only the author can edit a comment" }, { status: 403 });
    }
    if (!payload.body.trim()) return NextResponse.json({ error: "Comment cannot be empty" }, { status: 400 });
    if (payload.body.length > MAX_COMMENT_LENGTH) return NextResponse.json({ error: "Comment is too long" }, { status: 413 });
    data.body = payload.body.trim();
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const updated = await prisma.meetingMinutesComment.update({ where: { id: ctx.comment.id }, data });
  return NextResponse.json(updated);
}

/** DELETE — the author or the meeting owner. Replies cascade. */
export async function DELETE(req: NextRequest, { params }: { params: { meetingId: string; commentId: string } }) {
  const ctx = await loadContext(req, params);
  if ("error" in ctx) return ctx.error;

  const isAuthor = ctx.comment.authorEmail.toLowerCase() === ctx.email.toLowerCase();
  if (!isAuthor && ctx.role !== "owner") {
    return NextResponse.json({ error: "Only the author or the owner can delete a comment" }, { status: 403 });
  }
  await prisma.meetingMinutesComment.delete({ where: { id: ctx.comment.id } });
  return NextResponse.json({ ok: true });
}
