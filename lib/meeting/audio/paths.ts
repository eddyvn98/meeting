/**
 * lib/meeting/audio/paths.ts
 *
 * Single source of truth for where a meeting's audio lives on disk — used by
 * chunks/route.ts (writes), finalize/route.ts (merges), and audio/route.ts
 * (serves), so the three routes can't drift on the directory layout.
 * data/meeting-audio/ is server-local disk, never public/ (see
 * chunks/route.ts's doc comment for why).
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const MEETING_AUDIO_ROOT = join(process.cwd(), "data", "meeting-audio");

export function meetingAudioDir(meetingId: string): string {
  return join(MEETING_AUDIO_ROOT, meetingId);
}

/** The stitched-together file for a multi-chunk live recording (see
 *  lib/meeting/audio/mergeAudioChunks.ts). Always AAC/M4A regardless of the
 *  source chunks' codec, since it's a fresh re-encode, not a copy. */
export function mergedAudioPath(meetingId: string): string {
  return join(meetingAudioDir(meetingId), "merged.m4a");
}

/** The continuous recording the browser uploads in one piece at End Meeting
 *  (`full.<ext>`, extension from the browser's own format). Unlike the merged
 *  chunks it has no joins, so it plays without dropouts. null when none. */
export async function findFullAudio(meetingId: string): Promise<string | null> {
  const names = await readdir(meetingAudioDir(meetingId)).catch(() => [] as string[]);
  const name = names.find((n) => n.startsWith("full.") && !n.endsWith(".uploading"));
  return name ? join(meetingAudioDir(meetingId), name) : null;
}
