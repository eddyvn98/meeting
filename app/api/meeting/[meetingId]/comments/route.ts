import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyMinutesComment } from "@/lib/meeting/notify";
import { resolveMeetingCallerEmail } from "../../_auth";
import { resolveMeetingAccess } from "../../_access";

const MAX_COMMENT_LENGTH = 10_000;

/** GET /api/meeting/[meetingId]/comments — every Minutes-row comment on the
 *  meeting, plus the caller's identity so the UI knows which ones are theirs. Any active access role (owner, editor, viewer) may read. */
export async function GET(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  const role = meeting ? await resolveMeetingAccess(meeting, email) : null;
  if (!meeting || !role) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const comments = await prisma.meetingMinutesComment.findMany({
    where: { meetingId: meeting.id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ comments, viewerEmail: email, role });
}

/** POST /api/meeting/[meetingId]/comments — add a comment (or a one-level
 *  reply) on a Minutes matter/row. Commenting does not change the document,
 *  so a shared VIEWER may do it too. */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  const role = meeting ? await resolveMeetingAccess(meeting, email) : null;
  if (!meeting || !role) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let payload: { anchorId?: unknown; body?: unknown; parentId?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { anchorId, body, parentId } = payload;
  if (typeof anchorId !== "string" || !anchorId || typeof body !== "string" || !body.trim()) {
    return NextResponse.json({ error: "anchorId and non-empty body required" }, { status: 400 });
  }
  if (anchorId.length > 200) return NextResponse.json({ error: "Invalid anchorId" }, { status: 400 });
  if (body.length > MAX_COMMENT_LENGTH) return NextResponse.json({ error: "Comment is too long" }, { status: 413 });

  let validParentId: string | null = null;
  let parentAuthor: string | null = null;
  if (typeof parentId === "string" && parentId) {
    const parent = await prisma.meetingMinutesComment.findUnique({ where: { id: parentId } });
    // One level deep: the parent must be a top-level comment on the same anchor.
    if (!parent || parent.meetingId !== meeting.id || parent.anchorId !== anchorId || parent.parentId) {
      return NextResponse.json({ error: "Invalid parentId" }, { status: 400 });
    }
    validParentId = parent.id;
    parentAuthor = parent.authorEmail;
  }

  const comment = await prisma.meetingMinutesComment.create({
    data: { meetingId: meeting.id, anchorId, authorEmail: email, body: body.trim(), parentId: validParentId },
  });
  await notifyMinutesComment(meeting, comment, parentAuthor);
  return NextResponse.json(comment, { status: 201 });
}
