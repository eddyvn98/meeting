/**
 * lib/meeting/audioRetention.ts
 *
 * Client-safe mirror of the server's audio-retention policy
 * (lib/meeting/audio/cleanupMeetingAudio.ts's scheduled sweep) — pure date
 * math only, no node:fs import, so it can run in both the sidebar row and
 * the result page. The server never tells the client WHEN it deleted a
 * meeting's audio (deleteMeetingAudioDir doesn't touch the DB row), so this
 * recomputes the same cutoff the sweep uses from `updatedAt` + the
 * retention window (GET /api/meeting/storage-info) to warn the user before
 * (and reflect it after) that sweep actually runs.
 */

import type { Meeting } from "./types";

/** Start showing a countdown warning this many days before deletion. */
export const AUDIO_EXPIRY_WARNING_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface AudioExpiryInfo {
  expiresAt: Date;
  /** Rounded up — "1" means "sometime today or tomorrow", never 0 while
   *  still technically before the cutoff. */
  daysLeft: number;
  isExpiringSoon: boolean;
  isExpired: boolean;
}

/** Returns null when there's nothing to warn about: the meeting has no
 *  audio file, or is still UPLOADING/PROCESSING (the sweep never touches an
 *  in-progress meeting regardless of age). */
export function computeAudioExpiry(
  meeting: Pick<Meeting, "status" | "audioUrl" | "updatedAt">,
  retentionDays: number,
): AudioExpiryInfo | null {
  if (!meeting.audioUrl || retentionDays <= 0) return null;
  if (meeting.status !== "READY" && meeting.status !== "FAILED") return null;

  const expiresAtMs = new Date(meeting.updatedAt).getTime() + retentionDays * MS_PER_DAY;
  const daysLeft = Math.ceil((expiresAtMs - Date.now()) / MS_PER_DAY);
  const isExpired = daysLeft <= 0;
  return {
    expiresAt: new Date(expiresAtMs),
    daysLeft,
    isExpired,
    isExpiringSoon: !isExpired && daysLeft <= AUDIO_EXPIRY_WARNING_DAYS,
  };
}

/** One-line countdown shown wherever the recording can be played or downloaded. */
export function describeAudioExpiry(expiry: AudioExpiryInfo): string {
  if (expiry.isExpired) return "Audio recording was auto-deleted";
  return `Audio auto-deletes in ${expiry.daysLeft} day${expiry.daysLeft === 1 ? "" : "s"} (${expiry.expiresAt.toLocaleDateString()})`;
}
