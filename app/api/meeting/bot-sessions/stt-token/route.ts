import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { isBotRunnerRequest, runnerId } from "../_auth";

export const runtime = "nodejs";

const ACTIVE = ["CLAIMED", "JOINING", "LOBBY", "JOINED", "CAPTURING", "STOP_REQUESTED"] as const;
const DEFAULT_TOKEN_TTL_SEC = 6 * 60 * 60;
const TOKEN_FINALIZE_GRACE_SEC = 30 * 60;
const MAX_TOKEN_TTL_SEC = 24 * 60 * 60;

export function recorderTokenTtlSec(env: NodeJS.ProcessEnv = process.env): number {
  const configuredTtl = Number(env.MEETING_BOT_RECORDER_TOKEN_TTL_SEC);
  const configuredMaxDurationMs = Number(env.MEETING_BOT_MAX_DURATION_MS);
  const durationBased =
    Number.isFinite(configuredMaxDurationMs) && configuredMaxDurationMs > 0
      ? Math.ceil(configuredMaxDurationMs / 1000) + TOKEN_FINALIZE_GRACE_SEC
      : DEFAULT_TOKEN_TTL_SEC;
  const requested =
    Number.isFinite(configuredTtl) && configuredTtl > 0
      ? Math.ceil(configuredTtl)
      : Math.max(DEFAULT_TOKEN_TTL_SEC, durationBased);
  return Math.min(MAX_TOKEN_TTL_SEC, Math.max(DEFAULT_TOKEN_TTL_SEC, requested));
}

/** Issues a short-lived NextAuth session token to the authenticated runner.
 * The runner never needs NEXTAUTH_SECRET itself; only the web server signs
 * this scoped bot identity after verifying ownership of the claimed session. */
export async function POST(req: NextRequest) {
  if (!isBotRunnerRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null) as { sessionId?: unknown } | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const session = await prisma.meetingBotSession.findUnique({ where: { id: sessionId } });
  if (
    !session ||
    session.runnerId !== runnerId(req) ||
    !ACTIVE.includes(session.status as typeof ACTIVE[number])
  ) {
    return NextResponse.json({ error: "Bot session is unavailable" }, { status: 409 });
  }

  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "Server authentication is not configured" }, { status: 500 });
  }

  const now = Math.floor(Date.now() / 1000);
  const tokenTtlSec = recorderTokenTtlSec();
  const email = session.ownerEmail.trim().toLowerCase();
  const token = await encode({
    token: {
      sub: `meeting-bot:${session.id}`,
      email,
      name: "Meeting STT Assistant",
      userId: `meeting-bot:${session.id}`,
      displayName: "Meeting STT Assistant",
      isDevSession: true,
      meetingBotSessionId: session.id,
      iat: now,
      exp: now + tokenTtlSec,
    },
    secret,
    maxAge: tokenTtlSec,
  });

  const secure = req.nextUrl.protocol === "https:";
  return NextResponse.json({
    token,
    cookieName: secure ? "__Secure-next-auth.session-token" : "next-auth.session-token",
    expiresAt: new Date((now + tokenTtlSec) * 1000).toISOString(),
  });
}
