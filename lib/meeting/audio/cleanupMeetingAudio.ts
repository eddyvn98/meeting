/**
 * lib/meeting/audio/cleanupMeetingAudio.ts
 *
 * Disk-hygiene for data/meeting-audio/ (paths.ts) — raw recording chunks and
 * merged files accumulate on the server's own disk (this is a local-dev
 * tool: "the server" is the same machine the user is running it on) and
 * nothing was ever deleting them. Three cleanup points:
 *   - pruneRawChunksAfterMerge: called right after finalize/route.ts merges
 *     chunks into merged.m4a — the numbered chunk files are redundant once
 *     that succeeds (audio/route.ts always prefers merged.m4a first).
 *   - deleteMeetingAudioDir: called from DELETE /api/meeting/[meetingId] —
 *     deleting a meeting used to leave its audio directory behind forever.
 *   - runScheduledCleanup: periodic sweep (throttled via
 *     maybeRunScheduledCleanup, called from GET /api/meeting) that removes
 *     orphaned directories (meeting no longer in the DB) and directories
 *     for meetings past MEETING_AUDIO_RETENTION_DAYS.
 */

import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { prisma } from "@/lib/prisma";
import { isRetryableFinalizeFailure } from "./finalizeRetry";
import { MEETING_AUDIO_ROOT, meetingAudioDir, mergedAudioPath } from "./paths";

/** How long a finished (READY/FAILED) meeting's audio stays on disk before
 *  the scheduled sweep removes it. The transcript/summary in the database
 *  are unaffected — only the audio file (playback, re-processing) is lost.
 *  0 (the default) keeps audio forever: a recording is irreplaceable, so
 *  deleting it is opt-in via MEETING_AUDIO_RETENTION_DAYS. */
export const RETENTION_DAYS = Math.max(0, Number(process.env.MEETING_AUDIO_RETENTION_DAYS) || 0);

export function shouldPruneMeetingAudioEntry(name: string, keepName = "merged.m4a"): boolean {
  return name !== keepName && !name.startsWith("full.");
}

/** Deletes every file in a meeting's audio directory except merged.m4a and
 *  the continuous full.<ext> recording. Filtering happens on the directory
 *  entry name before path joining, so it behaves identically on POSIX and
 *  Windows path separators. Best-effort — logs and swallows errors so a
 *  prune failure never blocks the finalize response that triggered it. */
export async function pruneRawChunksAfterMerge(meetingId: string): Promise<void> {
  const dir = meetingAudioDir(meetingId);
  const keepName = basename(mergedAudioPath(meetingId));
  try {
    const entries = await readdir(dir);
    await Promise.all(
      entries
        .filter((name) => shouldPruneMeetingAudioEntry(name, keepName))
        .map((name) => rm(join(dir, name), { force: true })),
    );
  } catch (err) {
    console.warn("[meeting] pruneRawChunksAfterMerge failed:", err instanceof Error ? err.message : String(err));
  }
}

/** Deletes a meeting's entire audio directory. Best-effort — a missing
 *  directory (nothing was ever uploaded) is not an error. */
export async function deleteMeetingAudioDir(meetingId: string): Promise<void> {
  try {
    await rm(meetingAudioDir(meetingId), { recursive: true, force: true });
  } catch (err) {
    console.warn("[meeting] deleteMeetingAudioDir failed:", err instanceof Error ? err.message : String(err));
  }
}

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
let lastSweepAt = 0;

/** Opportunistic scheduler: called from GET /api/meeting (the most
 *  frequently hit meeting endpoint — home screen, sidebar) instead of a
 *  dedicated instrumentation.ts + setInterval. That approach was tried
 *  first but Next's instrumentation hook is edge+nodejs dual-bundled by
 *  default, and this module's node:fs/promises import broke the edge
 *  bundle even behind a NEXT_RUNTIME guard (confirmed live — webpack still
 *  statically resolves a dynamically-imported module's own imports for
 *  every runtime bundle). A throttled call from a plain Node.js route
 *  handler (never edge-bundled unless explicitly opted in) sidesteps that
 *  entirely. Fire-and-forget — never awaited by the caller. */
export function maybeRunScheduledCleanup(): void {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  void runScheduledCleanup();
}

/** Periodic sweep (see maybeRunScheduledCleanup for the schedule): removes
 *  audio directories that are either orphaned (no matching Meeting row —
 *  e.g. a manual DB edit, or a delete that ran before this module existed)
 *  or past retention (a READY/FAILED meeting last touched more than
 *  RETENTION_DAYS ago). Never touches UPLOADING/PROCESSING meetings —
 *  those are still in active use regardless of age. Returns a small summary
 *  for logging; never throws. */
export async function runScheduledCleanup(): Promise<{ orphaned: number; expired: number }> {
  let orphaned = 0;
  let expired = 0;
  try {
    await mkdir(MEETING_AUDIO_ROOT, { recursive: true });
    const dirNames = await readdir(MEETING_AUDIO_ROOT);
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

    for (const meetingId of dirNames) {
      const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
      if (!meeting) {
        await deleteMeetingAudioDir(meetingId);
        orphaned++;
        continue;
      }
      // A finalize that failed on the server can still be retried from its chunks.
      const isFinished = (meeting.status === "READY" || meeting.status === "FAILED") && !isRetryableFinalizeFailure(meeting);
      if (RETENTION_DAYS > 0 && isFinished && meeting.updatedAt.getTime() < cutoff) {
        await deleteMeetingAudioDir(meetingId);
        expired++;
      }
    }
  } catch (err) {
    console.warn("[meeting] runScheduledCleanup failed:", err instanceof Error ? err.message : String(err));
  }
  if (orphaned > 0 || expired > 0) {
    console.log(`[meeting] cleanup: removed ${orphaned} orphaned + ${expired} expired audio director${orphaned + expired === 1 ? "y" : "ies"}`);
  }
  return { orphaned, expired };
}

async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) total += await dirSizeBytes(path);
      else total += (await stat(path)).size;
    }
  } catch {
    // Directory may not exist yet — 0 is the right answer, not an error.
  }
  return total;
}

/** Powers the "where are my files" info surfaced in the sidebar Storage
 *  widget (GET /api/meeting/storage-info) — the absolute path only means
 *  something to the person running this app locally, which is exactly who
 *  asks for it. */
export async function getStorageInfo(): Promise<{ path: string; retentionDays: number; totalBytes: number }> {
  return {
    path: MEETING_AUDIO_ROOT,
    retentionDays: RETENTION_DAYS,
    totalBytes: await dirSizeBytes(MEETING_AUDIO_ROOT),
  };
}
