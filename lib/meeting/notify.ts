/**
 * lib/meeting/notify.ts
 *
 * Creates bell notifications for the Meeting module and, when email is
 * configured (see notifyEmail.ts), a throttled email copy. Everything here is
 * best-effort: a failure must never fail the request that triggered it.
 */

import type { Meeting } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { emailConfig, sendNotificationEmail } from "./notifyEmail";

export type MeetingNotificationType = "COMMENT" | "REPLY" | "SHARE_INVITE";

/** At most one email per recipient and meeting in this window; the bell still gets every item. */
const EMAIL_THROTTLE_MS = 10 * 60_000;

const lower = (email: string) => email.trim().toLowerCase();
const clip = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function appBaseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
}

async function deliver(meeting: Meeting, recipients: { email: string; type: MeetingNotificationType; body: string }[], extra: { anchorId?: string; commentId?: string; actorEmail: string }) {
  if (recipients.length === 0) return;
  const created = await Promise.all(
    recipients.map((r) =>
      prisma.meetingNotification.create({
        data: { recipientEmail: r.email, meetingId: meeting.id, type: r.type, body: r.body, anchorId: extra.anchorId ?? null, commentId: extra.commentId ?? null, actorEmail: extra.actorEmail },
      }),
    ),
  );
  if (!emailConfig()) return;

  const link = `${appBaseUrl()}/meeting/${meeting.id}${extra.anchorId ? "/minutes" : ""}`;
  for (const row of created) {
    const recent = await prisma.meetingNotification.findFirst({
      where: { recipientEmail: row.recipientEmail, meetingId: meeting.id, emailedAt: { gt: new Date(Date.now() - EMAIL_THROTTLE_MS) } },
      select: { id: true },
    });
    if (recent) continue;
    const sent = await sendNotificationEmail({ to: row.recipientEmail, subject: `${meeting.title} — ${row.type === "SHARE_INVITE" ? "shared with you" : "new comment"}`, text: row.body, link });
    if (sent) await prisma.meetingNotification.update({ where: { id: row.id }, data: { emailedAt: new Date() } });
  }
}

/** Fans a Minutes comment out to the owner and every active share, minus the
 *  author. The parent comment's author gets REPLY; everyone else COMMENT. */
export async function notifyMinutesComment(meeting: Meeting, comment: { id: string; anchorId: string; body: string; authorEmail: string }, parentAuthorEmail: string | null): Promise<void> {
  try {
    const shares = await prisma.meetingShare.findMany({ where: { meetingId: meeting.id, revokedAt: null }, select: { invitedEmail: true, expiresAt: true } });
    const now = Date.now();
    const everyone = new Map<string, string>();
    for (const email of [meeting.ownerEmail, ...shares.filter((s) => !s.expiresAt || s.expiresAt.getTime() > now).map((s) => s.invitedEmail)]) everyone.set(lower(email), lower(email));
    everyone.delete(lower(comment.authorEmail));

    const author = comment.authorEmail;
    const parent = parentAuthorEmail ? lower(parentAuthorEmail) : null;
    const recipients = [...everyone.keys()].map((email) => ({
      email,
      type: (email === parent ? "REPLY" : "COMMENT") as MeetingNotificationType,
      body: `${author} ${email === parent ? "replied to your comment" : "commented"} in "${meeting.title}": ${clip(comment.body)}`,
    }));
    await deliver(meeting, recipients, { anchorId: comment.anchorId, commentId: comment.id, actorEmail: author });
  } catch {
    // Best-effort.
  }
}

/** Tells a newly invited person that a meeting was shared with them. */
export async function notifyShareInvite(meeting: Meeting, invitedEmail: string, actorEmail: string, role: "viewer" | "editor"): Promise<void> {
  try {
    await deliver(meeting, [{ email: lower(invitedEmail), type: "SHARE_INVITE", body: `${actorEmail} shared "${meeting.title}" with you (${role})` }], { actorEmail });
  } catch {
    // Best-effort.
  }
}
