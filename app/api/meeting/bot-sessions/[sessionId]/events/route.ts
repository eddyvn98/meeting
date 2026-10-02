import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isBotRunnerRequest, runnerId } from "../../_auth";
import { MEETING_BOT_STATUSES, type MeetingBotEventInput } from "@/lib/meeting/bot/types";
import { serializeMeetingBotSession } from "@/lib/meeting/bot/serialize";
import { maybePruneTerminalBotSessions } from "@/lib/meeting/bot/pruneBotSessions";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { sessionId: string } }) {
  if (!isBotRunnerRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Partial<MeetingBotEventInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.status !== "string" || !MEETING_BOT_STATUSES.includes(body.status as MeetingBotEventInput["status"])) {
    return NextResponse.json({ error: "A valid bot status is required." }, { status: 400 });
  }

  const session = await prisma.meetingBotSession.findUnique({ where: { id: params.sessionId } });
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (session.runnerId !== runnerId(req)) {
    return NextResponse.json({ error: "Session is owned by another runner." }, { status: 409 });
  }
  if (["ENDED", "FAILED"].includes(session.status)) {
    return NextResponse.json(serializeMeetingBotSession(session));
  }
  if (session.status === "STOP_REQUESTED" && !["STOP_REQUESTED", "ENDED", "FAILED"].includes(body.status)) {
    return NextResponse.json(serializeMeetingBotSession(session));
  }

  const meetingId = body.meetingId ?? session.meetingId;
  if (meetingId) {
    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { ownerEmail: true } });
    if (!meeting || meeting.ownerEmail.toLowerCase() !== session.ownerEmail.toLowerCase()) {
      return NextResponse.json({ error: "Meeting does not belong to this session owner." }, { status: 400 });
    }
  }

  const status = body.status as MeetingBotEventInput["status"];
  const failureReason = typeof body.errorMessage === "string" ? body.errorMessage.slice(0, 4000) : "The bot runner failed.";
  const updated = await prisma.$transaction(async (tx) => {
    const nextSession = await tx.meetingBotSession.update({
      where: { id: session.id },
      data: {
        status,
        runnerId: session.runnerId ?? runnerId(req),
        meetingId: meetingId ?? undefined,
        errorMessage:
          typeof body.errorMessage === "string"
            ? body.errorMessage.slice(0, 4000)
            : status === "FAILED"
              ? failureReason
              : ["STOP_REQUESTED", "ENDED"].includes(status)
                ? session.errorMessage
                : null,
        lastHeartbeatAt: new Date(),
        startedAt: ["JOINING", "LOBBY", "JOINED", "CAPTURING"].includes(status) ? session.startedAt ?? new Date() : undefined,
        endedAt: ["ENDED", "FAILED"].includes(status) ? new Date() : undefined,
      },
    });
    if (status === "FAILED" && meetingId) {
      await tx.meeting.updateMany({
        where: { id: meetingId, status: "UPLOADING" },
        data: { status: "FAILED", failureReason },
      });
    }
    return nextSession;
  });
  if (["ENDED", "FAILED"].includes(status)) {
    maybePruneTerminalBotSessions(updated.ownerEmail);
  }
  return NextResponse.json(serializeMeetingBotSession(updated));
}
