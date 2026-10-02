import { prisma } from "@/lib/prisma";
import type { Meeting } from "@prisma/client";

/** "owner" can rename/delete/manage shares; "editor" (an active MeetingShare
 *  grant with role EDITOR) additionally gets sections CRUD, summary/minutes
 *  PATCH, and minutes generate — see requireMeetingEditor; "viewer" (an
 *  active MeetingShare grant with role VIEWER, the default) can only read +
 *  ask + translate — see each route's own check for exactly which actions
 *  it allows. Share management (list/add/change role/revoke) stays
 *  owner-only regardless of editor/viewer. */
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
  if (!share || share.revokedAt) return null;
  if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) return null;
  return share.role === "EDITOR" ? "editor" : "viewer";
}
