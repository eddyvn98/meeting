import crypto from "node:crypto";
import { NextRequest } from "next/server";

export function isBotRunnerRequest(req: NextRequest): boolean {
  const expected = process.env.MEETING_BOT_RUNNER_TOKEN;
  const received = req.headers.get("x-meeting-bot-token");
  if (!expected || !received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && crypto.timingSafeEqual(expectedBytes, receivedBytes);
}

export function runnerId(req: NextRequest): string {
  return req.headers.get("x-meeting-bot-runner-id")?.trim().slice(0, 120) || "browser-runner";
}
