import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isBotRunnerRequest, runnerId } from "../../_auth";
import { MEETING_BOT_STATUSES, type MeetingBotEventInput, type MeetingBotStatus } from "@/lib/meeting/bot/types";
import { canTransitionMeetingBotStatus } from "@/lib/meeting/bot/statusTransitions";
import { serializeMeetingBotSession } from "@/lib/meeting/bot/serialize";
import { maybePruneTerminalBotSessions } from "@/lib/meeting/bot/pruneBotSessions";
import { parseSpeakerObservations, sanitizeParticipantNames } from "@/lib/meeting/bot/rosterMapping";
import { sanitizeMeetingAttendeeEmails } from "@/lib/meeting/bot/attendeeEmails";
import type { Prisma } from "@prisma/client";
import { notifyLiveRoomStarted } from "@/lib/meeting/notify";
import { CAPTURE_INTERRUPTED_PREFIX } from "@/lib/meeting/audio/finalizeRetry";
import { shouldFailMeetingForBotFailure, type MeetingBotFailureScope } from "@/lib/meeting/bot/meetingFailurePolicy";

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
  if (
    body.expectedStatus !== undefined &&
    (typeof body.expectedStatus !== "string" ||
      !MEETING_BOT_STATUSES.includes(body.expectedStatus as MeetingBotStatus))
  ) {
    return NextResponse.json({ error: "expectedStatus must be a valid bot status." }, { status: 400 });
  }
  if (
    body.meetingFailureScope !== undefined &&
    body.meetingFailureScope !== "CAPTURE" &&
    body.meetingFailureScope !== "PROCESSING"
  ) {
    return NextResponse.json({ error: "meetingFailureScope must be CAPTURE or PROCESSING." }, { status: 400 });
  }

  const session = await prisma.meetingBotSession.findUnique({ where: { id: params.sessionId } });
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const requestRunnerId = runnerId(req);
  if (session.runnerId !== requestRunnerId) {
    return NextResponse.json({ error: "Session is owned by another runner." }, { status: 409 });
  }

  const status = body.status as MeetingBotStatus;
  const expectedStatus = (body.expectedStatus ?? session.status) as MeetingBotStatus;
  if (session.status !== expectedStatus) {
    return NextResponse.json(
      { error: "Stale bot lifecycle update.", currentStatus: session.status, expectedStatus },
      { status: 409 },
    );
  }
  if (!canTransitionMeetingBotStatus(session.status as MeetingBotStatus, status)) {
    return NextResponse.json(
      { error: `Invalid bot lifecycle transition: ${session.status} -> ${status}.`, currentStatus: session.status },
      { status: 409 },
    );
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

  const failureReason = typeof body.errorMessage === "string" ? body.errorMessage.slice(0, 4000) : "The bot runner failed.";
  const updated = await prisma.$transaction(async (tx) => {
    const updatedCount = await tx.meetingBotSession.updateMany({
      where: { id: session.id, runnerId: requestRunnerId, status: expectedStatus },
      data: {
        status,
        runnerId: session.runnerId ?? requestRunnerId,
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
    if (updatedCount.count !== 1) {
      const current = await tx.meetingBotSession.findUnique({ where: { id: session.id } });
      const conflict = new Error("STALE_BOT_LIFECYCLE_UPDATE");
      (conflict as Error & { currentStatus?: string }).currentStatus = current?.status;
      throw conflict;
    }
    const nextSession = await tx.meetingBotSession.findUniqueOrThrow({ where: { id: session.id } });
    if (status === "FAILED" && meetingId) {
      const linkedMeeting = await tx.meeting.findUnique({
        where: { id: meetingId },
        select: { status: true, failureReason: true },
      });
      const failureScope = (body.meetingFailureScope ?? "CAPTURE") as MeetingBotFailureScope;
      if (linkedMeeting && shouldFailMeetingForBotFailure(linkedMeeting, failureScope)) {
        await tx.meeting.update({
          where: { id: meetingId },
          data: {
            status: "FAILED",
            failureReason:
              failureScope === "CAPTURE"
                ? `${CAPTURE_INTERRUPTED_PREFIX}${failureReason}`
                : failureReason,
          },
        });
      }
    }
    return nextSession;
  }).catch(async (error) => {
    if (error instanceof Error && error.message === "STALE_BOT_LIFECYCLE_UPDATE") {
      const current = await prisma.meetingBotSession.findUnique({ where: { id: session.id } });
      return NextResponse.json(
        { error: "Stale bot lifecycle update.", currentStatus: current?.status ?? null, expectedStatus },
        { status: 409 },
      );
    }
    throw error;
  });
  if (updated instanceof NextResponse) return updated;
  if (attendeeEmails !== undefined && updated.attendeeEmails.length > previousAttendeeCount) {
    console.log(
      `[meeting-bot][identity] session=${session.id} source=server code=ATTENDEE_EMAILS_PERSISTED ` +
      `added=${updated.attendeeEmails.length - previousAttendeeCount} totalEmails=${updated.attendeeEmails.length}`,
    );
  }
  const firstCaptureTransition = status === "CAPTURING" && session.status !== "CAPTURING";
  const discoveredAttendee = updated.attendeeEmails.length > previousAttendeeCount;
  if (status === "CAPTURING" && meetingId && (firstCaptureTransition || discoveredAttendee)) {
    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (meeting) {
      await notifyLiveRoomStarted(meeting, updated.attendeeEmails).catch((error) => {
        console.warn(
          `[meeting-bot] live-room notification failed for session ${session.id} without failing lifecycle:`,
          error instanceof Error ? error.message : String(error),
        );
      });
    }
  }
  if (["ENDED", "FAILED"].includes(status)) {
    maybePruneTerminalBotSessions(updated.ownerEmail);
  }
  return NextResponse.json(serializeMeetingBotSession(updated));
}
