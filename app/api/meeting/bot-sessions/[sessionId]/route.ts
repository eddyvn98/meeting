import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { serializeMeetingBotSession } from "@/lib/meeting/bot/serialize";
import { isBotRunnerRequest } from "../_auth";

const STOPPABLE = new Set(["REQUESTED", "CLAIMED", "JOINING", "LOBBY", "JOINED", "CAPTURING"]);

export async function GET(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const session = await prisma.meetingBotSession.findUnique({ where: { id: params.sessionId } });
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!isBotRunnerRequest(req)) {
    const email = await resolveMeetingCallerEmail(req);
    if (!email || email !== session.ownerEmail.toLowerCase()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }
  return NextResponse.json(serializeMeetingBotSession(session));
}

export async function POST(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const session = await prisma.meetingBotSession.findUnique({ where: { id: params.sessionId } });
  if (!session || session.ownerEmail.toLowerCase() !== email) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!STOPPABLE.has(session.status)) return NextResponse.json(serializeMeetingBotSession(session));

  const changed = await prisma.meetingBotSession.updateMany({
    where: { id: session.id, status: session.status },
    data: { status: "STOP_REQUESTED", lastHeartbeatAt: new Date() },
  });
  if (changed.count !== 1) {
    const current = await prisma.meetingBotSession.findUnique({ where: { id: session.id } });
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(serializeMeetingBotSession(current));
  }
  const updated = await prisma.meetingBotSession.findUniqueOrThrow({ where: { id: session.id } });
  return NextResponse.json(serializeMeetingBotSession(updated));
}

const TERMINAL = ["ENDED", "FAILED"] as const;

/** Removes one finished session from the user's list. The recorded meeting itself is kept. */
export async function DELETE(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await prisma.meetingBotSession.deleteMany({
    where: { id: params.sessionId, ownerEmail: email, status: { in: [...TERMINAL] } },
  });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ deleted: result.count });
}
