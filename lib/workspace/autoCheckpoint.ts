/**
 * lib/workspace/autoCheckpoint.ts
 *
 * Automatic version checkpoints for a workspace board.
 *
 * Without these, a board's version history contains only what the user
 * remembered to click "save version" on. Restoring then discards everything
 * since that click, with no intermediate point to come back to — someone who
 * worked for two hours and never clicked has nothing to return to.
 *
 * Legacy bounds that loss in time from the realtime service
 * (docker/mindmap-ws/src/snapshot-scheduler.js: flush 2s after editing stops,
 * and at the latest every 15s while it continues). v2 has no realtime
 * transport and no scheduler, so the bound is enforced here instead, on the
 * autosave write itself: a checkpoint is written when the newest automatic one
 * is older than AUTO_CHECKPOINT_MIN_INTERVAL_MS. Stateless by design — there
 * is no timer to keep alive between requests.
 *
 * The cadence is deliberately far thinner than legacy's flush cadence, and
 * capped, because the two are not the same job. Legacy's 15s bound IS that
 * map's durability (the Y.Doc is the only writer while a session is live). A
 * v2 board is already durable on every autosave; these rows only decide how
 * far back a user can step. 2 minutes of exposure, 50 rows per board.
 *
 * Manual "save version" checkpoints (label set) are never subject to the
 * cadence and are never pruned — they are the user's own bookmarks.
 */
import { prisma } from "@/lib/prisma";

export const AUTO_CHECKPOINT_MIN_INTERVAL_MS = Number(
  process.env.WORKSPACE_AUTO_CHECKPOINT_INTERVAL_MS || 120_000,
);

export const AUTO_CHECKPOINT_KEEP = Number(process.env.WORKSPACE_AUTO_CHECKPOINT_KEEP || 50);

export interface CheckpointContent {
  blocks: unknown;
  blockOrder: unknown;
  connectors: unknown;
}

/**
 * Writes an automatic checkpoint for `boardId` if enough time has passed since
 * the last one, then prunes automatic checkpoints beyond the newest
 * AUTO_CHECKPOINT_KEEP.
 *
 * Returns whether a checkpoint was written. Never throws: this runs after the
 * board has already been saved, and a history row that could not be written
 * must not turn a successful save into an error the user sees.
 */
export async function maybeWriteAutoCheckpoint(
  boardId: string,
  content: CheckpointContent,
  actorEmail: string,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const automatic = await prisma.workspaceBoardSnapshot.findMany({
      where: { boardId, label: null },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const newest = automatic[0]?.createdAt;
    if (newest && now.getTime() - newest.getTime() < AUTO_CHECKPOINT_MIN_INTERVAL_MS) {
      return false;
    }

    await prisma.workspaceBoardSnapshot.create({
      data: {
        boardId,
        blocks: content.blocks as never,
        blockOrder: content.blockOrder as never,
        connectors: content.connectors as never,
        label: null,
        createdBy: actorEmail,
      },
    });

    await pruneAutomaticCheckpoints(boardId, automatic);
    return true;
  } catch {
    // Best-effort — see the doc comment.
    return false;
  }
}

/**
 * Drops the oldest automatic checkpoints so the newest AUTO_CHECKPOINT_KEEP
 * survive. `before` is the automatic rows as they were BEFORE the new one was
 * inserted, newest first, so the last row worth keeping among them sits at
 * index KEEP - 2 (the new row occupies the first slot).
 *
 * Deleting by `createdAt < cutoff` keeps any row sharing the cutoff's
 * timestamp, so a tie over-retains rather than over-deletes. Losing history
 * is the failure worth avoiding here; keeping one row too many is not.
 */
async function pruneAutomaticCheckpoints(
  boardId: string,
  before: Array<{ createdAt: Date }>,
): Promise<void> {
  if (before.length + 1 <= AUTO_CHECKPOINT_KEEP) return;

  if (AUTO_CHECKPOINT_KEEP <= 1) {
    const ceiling = before[0]?.createdAt;
    if (ceiling) {
      await prisma.workspaceBoardSnapshot.deleteMany({
        where: { boardId, label: null, createdAt: { lte: ceiling } },
      });
    }
    return;
  }

  const cutoff = before[AUTO_CHECKPOINT_KEEP - 2]?.createdAt;
  if (!cutoff) return;
  await prisma.workspaceBoardSnapshot.deleteMany({
    where: { boardId, label: null, createdAt: { lt: cutoff } },
  });
}
