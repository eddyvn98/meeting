import crypto from "node:crypto";
import { NextRequest } from "next/server";

function sameSecret(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length
    && crypto.timingSafeEqual(expectedBytes, receivedBytes);
}

/**
 * Read-only service authentication for the separate usage/dashboard web.
 * Deliberately uses a different secret from the STT provider key.
 */
export function isSttUsageServiceRequest(req: NextRequest): boolean {
  const expected = process.env.MEETING_STT_USAGE_API_TOKEN?.trim();
  if (!expected) return false;

  const authorization = req.headers.get("authorization")?.trim() ?? "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const headerToken = req.headers.get("x-meeting-stt-usage-token")?.trim() ?? "";
  const received = bearer || headerToken;

  return Boolean(received) && sameSecret(expected, received);
}
