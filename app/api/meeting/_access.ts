import { prisma } from "@/lib/prisma";
import type { Meeting } from "@prisma/client";

/** "owner" is the administrative owner; it does NOT mean the meeting content
 *  belongs only to that person. A Teams calendar attendee on the linked bot
 *  occurrence gets implicit "viewer" access to the same shared Meeting.
 *  Explicit MeetingShare grants remain for people outside the Teams attendee
 *  list; an explicit editor grant upgrades an attendee from viewer to editor.
 *  Share management (list/add/change role/revoke) stays owner-only. */
export type MeetingAccessRole = "owner" | "editor" | "viewer" | null;

const canonical = (email: string) => email.trim().toLowerCase();

/** A share counts as active only while it's neither revoked nor past its
 *  optional expiry — checked here (not just at grant time) so an expired
 *  share silently stops working the moment it lapses, no cleanup job
 *  needed. */
export async function resolveMeetingAccess(meeting: Meeting, email: string): Promise<MeetingAccessRole> {
  const caller = canonical(email);
  if (meeting.ownerEmail.toLowerCase() === caller) return "owner";

  const share = await prisma.meetingShare.findUnique({
    where: { meetingId_invitedEmail: { meetingId: meeting.id, invitedEmail: caller } },
  });
  if (share && !share.revokedAt && (!share.expiresAt || share.expiresAt.getTime() > Date.now())) {
    return share.role === "EDITOR" ? "editor" : "viewer";
  }

  // Calendar-backed Teams rooms are shared by occurrence. Graph stores the
  // attendee emails on the bot session before capture starts; once the runner
  // links that session to the Meeting, every attendee can open the same live
  // transcript/result without anyone manually sharing it.
  const attendeeSession = await prisma.meetingBotSession.findFirst({
    where: { meetingId: meeting.id, presentAttendeeEmails: { has: caller } },
    select: { id: true },
  });
  return attendeeSession ? "viewer" : null;
}
