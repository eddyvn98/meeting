/**
 * lib/meeting/audio/paths.ts
 *
 * Single source of truth for where a meeting's audio lives on disk — used by
 * chunks/route.ts (writes), finalize/route.ts (merges), and audio/route.ts
 * (serves), so the three routes can't drift on the directory layout.
 * data/meeting-audio/ is server-local disk, never public/ (see
 * chunks/route.ts's doc comment for why).
 */

import { readdir, stat } from "node:fs/promises";
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

/** Private output path for one finalize lease. A stale lease may be reclaimed
 * while the old ffmpeg process is still finishing, so workers must never
 * encode directly into the shared merged.m4a path. Only the lease winner
 * promotes its private file to merged.m4a under the advisory DB lock. */
export function finalizeWorkAudioPath(meetingId: string, finalizeId: string): string {
  const safeId = finalizeId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return join(meetingAudioDir(meetingId), `.finalize-${safeId || "unknown"}.m4a`);
}

/** The continuous recording the browser uploads in one piece at End Meeting
 *  (`full.<ext>`, extension from the browser's own format). Unlike the merged
 *  chunks it has no joins, so it plays without dropouts. null when none. */
export async function findFullAudio(meetingId: string): Promise<string | null> {
  const dir = meetingAudioDir(meetingId);
  const names = await readdir(dir).catch(() => [] as string[]);
  const candidates = names
    .filter((name) => name.startsWith("full.") && !name.endsWith(".uploading"))
    .map((name) => join(dir, name));
  if (candidates.length === 0) return null;
  const withStats = await Promise.all(
    candidates.map(async (path) => ({
      path,
      mtimeMs: (await stat(path).catch(() => null))?.mtimeMs ?? -1,
    })),
  );
  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
  return withStats[0]?.mtimeMs >= 0 ? withStats[0].path : null;
}
