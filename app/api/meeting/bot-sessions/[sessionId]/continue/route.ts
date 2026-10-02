import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isBotRunnerRequest, runnerId } from "../../_auth";
import { serializeMeetingBotSession } from "@/lib/meeting/bot/serialize";

export const runtime = "nodejs";

const DEFAULT_MAX_CONTINUATIONS = 2;

function maxContinuations(): number {
  const value = Number(process.env.MEETING_BOT_MAX_CONTINUATIONS);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_MAX_CONTINUATIONS;
}

function continuationDepth(sourceKey: string | null): number {
  return (sourceKey?.match(/:continuation:/g) ?? []).length;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  if (!isBotRunnerRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parent = await prisma.meetingBotSession.findUnique({ where: { id: params.sessionId } });
  if (!parent) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (parent.runnerId && parent.runnerId !== runnerId(req)) {
    return NextResponse.json({ error: "Session is owned by another runner." }, { status: 409 });
  }
  if (parent.status !== "FAILED") {
    return NextResponse.json(
      { error: "Only a failed bot session can create a continuation." },
      { status: 409 },
    );
  }

  if (continuationDepth(parent.sourceKey) >= maxContinuations()) {
    return NextResponse.json({ error: "Continuation limit reached." }, { status: 409 });
  }

  const baseKey = parent.sourceKey ?? parent.id;
  const sourceKey = `${baseKey}:continuation:${parent.id}`;

  const continuation = await prisma.meetingBotSession.upsert({
    where: {
      source_sourceKey: {
        source: parent.source,
        sourceKey,
      },
    },
    update: {},
    create: {
      ownerEmail: parent.ownerEmail,
      meetingUrl: parent.meetingUrl,
      title: parent.title,
      source: parent.source,
      sourceKey,
      scheduledAt: null,
      errorMessage: "Automatic continuation after an interrupted bot session.",
    },
  });

  return NextResponse.json(serializeMeetingBotSession(continuation), { status: 201 });
}
