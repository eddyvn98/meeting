/**
 * app/api/meeting/[meetingId]/sections/_shared.ts
 *
 * Shared auth/lookup helper for the sections CRUD routes (route.ts,
 * [sectionId]/route.ts, reorder/route.ts) and the summary/minutes PATCH +
 * minutes/generate routes — content editing is allowed for the owner OR an
 * active MeetingShare grant with role "editor" (see
 * app/api/meeting/_access.ts's MeetingAccessRole). Share management
 * (list/add/change role/revoke) is NOT covered here — that stays
 * owner-only and is checked directly in app/api/meeting/[meetingId]/shares/*.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { resolveMeetingAccess } from "../../_access";
import type { Meeting, MeetingSummary } from "@prisma/client";

export type SectionsAuthResult =
  | { ok: true; email: string; meeting: Meeting; summary: MeetingSummary }
  | { ok: false; response: NextResponse };

/** Resolves the caller, checks owner-or-editor access, and loads the
 *  meeting's MeetingSummary row (sections hang off the summary, not the
 *  meeting directly). Returns a ready-to-return NextResponse for every
 *  failure case so route handlers can `if (!auth.ok) return auth.response;`
 *  and move on. */
export async function requireMeetingEditor(req: NextRequest, meetingId: string): Promise<SectionsAuthResult> {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  const role = meeting ? await resolveMeetingAccess(meeting, email) : null;
  if (!meeting || (role !== "owner" && role !== "editor")) {
    return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  const summary = await prisma.meetingSummary.findUnique({ where: { meetingId: meeting.id } });
  if (!summary) {
    return { ok: false, response: NextResponse.json({ error: "This meeting has no summary yet" }, { status: 400 }) };
  }

  return { ok: true, email, meeting, summary };
}
