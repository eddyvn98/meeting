import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { isBotRecorderRequestAllowed } from "@/lib/meeting/bot/recorderScope";

/**
 * Same session-resolution shape as app/api/workspaces/_auth.ts and
 * app/api/mindmaps/_auth.ts, duplicated rather than imported so this feature
 * stays independent of the others (same convention every tool in this repo
 * follows). Email IS the identity here (no users table); the resolved
 * address is always lower-cased and trimmed so the same person is never
 * stored as two identities.
 */
const canonical = (email: string) => email.trim().toLowerCase();

export interface MeetingCaller {
  email: string;
  meetingBotSessionId?: string;
}

export async function resolveMeetingCaller(req: NextRequest): Promise<MeetingCaller | null> {
  if (process.env.NODE_ENV !== "production") {
    const mockEmailCookie = req.cookies.get("mock-email")?.value;
    if (mockEmailCookie?.trim()) return { email: canonical(mockEmailCookie) };
  }

  const token = await getToken({ req });
  if (typeof token?.email === "string" && token.email.trim()) {
    const email = canonical(token.email);
    const botSessionId =
      typeof token.meetingBotSessionId === "string" ? token.meetingBotSessionId.trim() : "";

    if (botSessionId) {
      const session = await prisma.meetingBotSession.findUnique({
        where: { id: botSessionId },
        select: { id: true, ownerEmail: true, status: true, meetingId: true },
      });
      if (
        !session ||
        session.ownerEmail.trim().toLowerCase() !== email ||
        !isBotRecorderRequestAllowed(req.nextUrl.pathname, req.method, session)
      ) {
        return null;
      }
      return { email, meetingBotSessionId: session.id };
    }

    return { email };
  }

  if (process.env.NODE_ENV !== "production") {
    return {
      email: canonical(
        process.env.NEXT_PUBLIC_DEV_USER_EMAIL
          ?? process.env.NEXT_PUBLIC_FINANCE_DEV_EMAIL
          ?? "user@company.com",
      ),
    };
  }

  return null;
}

export async function resolveMeetingCallerEmail(req: NextRequest): Promise<string | null> {
  return (await resolveMeetingCaller(req))?.email ?? null;
}
