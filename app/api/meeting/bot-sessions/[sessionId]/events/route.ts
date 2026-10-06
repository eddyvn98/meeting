import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isBotRunnerRequest, runnerId } from "../../_auth";
import { MEETING_BOT_STATUSES, type MeetingBotEventInput } from "@/lib/meeting/bot/types";
import { serializeMeetingBotSession } from "@/lib/meeting/bot/serialize";
import { maybePruneTerminalBotSessions } from "@/lib/meeting/bot/pruneBotSessions";
import { parseSpeakerObservations, sanitizeParticipantNames } from "@/lib/meeting/bot/rosterMapping";
import { sanitizeMeetingAttendeeEmails } from "@/lib/meeting/bot/attendeeEmails";
import type { Prisma } from "@prisma/client";

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

  if (body.participantNames !== undefined && !Array.isArray(body.participantNames)) {
    return NextResponse.json({ error: "participantNames must be an array." }, { status: 400 });
  }
  if (body.attendeeEmails !== undefined && !Array.isArray(body.attendeeEmails)) {
    return NextResponse.json({ error: "attendeeEmails must be an array." }, { status: 400 });
  }
  if (body.speakerObservations !== undefined && !Array.isArray(body.speakerObservations)) {
    return NextResponse.json({ error: "speakerObservations must be an array." }, { status: 400 });
  }
  const participantNames =
    body.participantNames === undefined ? undefined : sanitizeParticipantNames(body.participantNames);
  const previousAttendeeCount = session.attendeeEmails.length;
  const attendeeEmails =
    body.attendeeEmails === undefined
      ? undefined
      : sanitizeMeetingAttendeeEmails([...session.attendeeEmails, ...body.attendeeEmails]);
  const speakerObservations =
    body.speakerObservations === undefined ? undefined : parseSpeakerObservations(body.speakerObservations);

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
        participantNames,
        attendeeEmails,
        speakerObservations:
          speakerObservations === undefined
            ? undefined
            : (speakerObservations as unknown as Prisma.InputJsonValue),
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
  if (attendeeEmails !== undefined && updated.attendeeEmails.length > previousAttendeeCount) {
    console.log(
      `[meeting-bot][identity] session=${session.id} source=server code=ATTENDEE_EMAILS_PERSISTED ` +
      `added=${updated.attendeeEmails.length - previousAttendeeCount} totalEmails=${updated.attendeeEmails.length}`,
    );
  }
  if (["ENDED", "FAILED"].includes(status)) {
    maybePruneTerminalBotSessions(updated.ownerEmail);
  }
  return NextResponse.json(serializeMeetingBotSession(updated));
}
