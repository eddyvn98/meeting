import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { resolveMeetingAccess } from "../../_access";
import { serializeTranscriptSegment } from "@/lib/meeting/serialize";

export const runtime = "nodejs";

type LiveInput = { start: number; end: number; text: string };

function validSegment(value: unknown): value is LiveInput {
  if (!value || typeof value !== "object") return false;
  const segment = value as Partial<LiveInput>;
  return Number.isFinite(segment.start) && Number.isFinite(segment.end)
    && typeof segment.text === "string" && segment.text.trim().length > 0
    && segment.text.length <= 5_000;
}

async function readMeeting(meetingId: string, email: string) {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) return null;
  const accessRole = await resolveMeetingAccess(meeting, email);
  return accessRole ? { meeting, accessRole } : null;
}

export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await readMeeting(params.meetingId, email);
  if (!access || access.meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null) as { segments?: unknown } | null;
  const input = Array.isArray(body?.segments) ? body.segments : [];
  if (input.length === 0 || input.length > 100 || !input.every(validSegment)) {
    return NextResponse.json({ error: "segments must contain 1-100 valid items" }, { status: 400 });
  }

  const textField = access.meeting.sttLanguage.toLowerCase().startsWith("vi") ? "textVi" : "textEn";
  const created = await prisma.$transaction(async (tx) => {
    const last = await tx.transcriptSegment.findFirst({
      where: { meetingId: params.meetingId }, orderBy: { order: "desc" }, select: { order: true },
    });
    let nextOrder = (last?.order ?? -1) + 1;
    const result = [];
    for (const item of input as LiveInput[]) {
      const startTimeMs = Math.max(0, Math.round(item.start * 1000));
      const endTimeMs = Math.max(startTimeMs, Math.round(item.end * 1000));
      const text = item.text.trim();
      const duplicate = await tx.transcriptSegment.findFirst({
        where: { meetingId: params.meetingId, startTimeMs, endTimeMs, [textField]: text },
      });
      if (duplicate) continue;
      const segment = await tx.transcriptSegment.create({
        data: {
          meetingId: params.meetingId, speakerKey: "speaker_1", order: nextOrder++, startTimeMs, endTimeMs,
          ...(textField === "textVi" ? { textVi: text } : { textEn: text }),
        },
      });
      await tx.speaker.upsert({
        where: { meetingId_speakerKey: { meetingId: params.meetingId, speakerKey: "speaker_1" } },
        create: { meetingId: params.meetingId, speakerKey: "speaker_1" }, update: {},
      });
      result.push(segment);
    }
    return result;
  });

  return NextResponse.json({ segments: created.map((segment) => serializeTranscriptSegment(segment, new Map())) });
}

export async function GET(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await readMeeting(params.meetingId, email);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const encoder = new TextEncoder();
  let closed = false;
  let lastOrder = -1;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (type: string, payload: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`));
      };
      const poll = async () => {
        const current = await prisma.meeting.findUnique({ where: { id: params.meetingId }, select: { status: true } });
        if (!current) return;
        const segments = await prisma.transcriptSegment.findMany({
          where: { meetingId: params.meetingId, order: { gt: lastOrder } }, orderBy: { order: "asc" },
        });
        for (const segment of segments) {
          lastOrder = Math.max(lastOrder, segment.order);
          send("segment", serializeTranscriptSegment(segment, new Map()));
        }
        if (["READY", "FAILED"].includes(current.status)) {
          send("status", { status: current.status });
          closed = true;
          if (timer) clearInterval(timer);
          controller.close();
        }
      };
      void poll().catch(() => undefined);
      timer = setInterval(() => void poll().catch(() => undefined), 1_000);
    },
    cancel() { closed = true; if (timer) clearInterval(timer); },
  });
  req.signal.addEventListener("abort", () => { closed = true; if (timer) clearInterval(timer); });
  return new Response(stream, { headers: { "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" } });
}
