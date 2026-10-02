import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeMeetingBotSession } from "@/lib/meeting/bot/serialize";
import { isBotRunnerRequest } from "../_auth";

export const runtime = "nodejs";

function validTeamsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    const allowed = ["teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft"];
    if (url.protocol !== "https:" || !allowed.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function text(value: unknown, fallback: string, max = 180): string {
  if (typeof value !== "string") return fallback;
  const clean = value.trim().replace(/\s+/g, " ");
  return clean.slice(0, max) || fallback;
}

function email(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) ? clean : null;
}

export async function POST(req: NextRequest) {
  if (!isBotRunnerRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { meetingUrl?: unknown; title?: unknown; ownerEmail?: unknown; sourceKey?: unknown; scheduledAt?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const meetingUrl = validTeamsUrl(body.meetingUrl);
  const ownerEmail = email(body.ownerEmail);
  const sourceKey = text(body.sourceKey, "", 240) || null;
  if (!meetingUrl || !ownerEmail || !sourceKey) {
    return NextResponse.json({ error: "Calendar discovery requires meetingUrl, ownerEmail, and sourceKey." }, { status: 400 });
  }

  const existing = await prisma.meetingBotSession.findUnique({ where: { source_sourceKey: { source: "CALENDAR", sourceKey } } });
  if (existing) return NextResponse.json(serializeMeetingBotSession(existing));

  const scheduledAt = typeof body.scheduledAt === "string" ? new Date(body.scheduledAt) : null;
  const session = await prisma.meetingBotSession.create({
    data: {
      ownerEmail,
      meetingUrl,
      title: text(body.title, "Teams Meeting"),
      source: "CALENDAR",
      sourceKey,
      scheduledAt: scheduledAt && !Number.isNaN(scheduledAt.valueOf()) ? scheduledAt : null,
    },
  });
  return NextResponse.json(serializeMeetingBotSession(session), { status: 201 });
}
