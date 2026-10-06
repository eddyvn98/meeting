/**
 * The one place a board's content is written.
 *
 * There are now two callers — a person's own save (PUT /api/workspaces/[id])
 * and a live room flushing itself (POST .../sync-board, called by the
 * realtime service) — and they must not be two implementations. Everything
 * that has to happen around the write (the revision refusal, the edit-event
 * history, the automatic checkpoint, the search reindex) is the same work
 * whichever caller asked for it, and a second copy of it would drift: one
 * caller would gain a fix the other silently lacks. That divergence is the
 * exact failure mode this audit kept finding, so it is designed out here
 * rather than watched for.
 */

import { Prisma, type WorkspaceBoard } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { maybeWriteAutoCheckpoint } from "@/lib/workspace/autoCheckpoint";
import { syncBlockChunksFromBoard } from "@/lib/workspace/knowledge-block-chunks";

export interface BoardContent {
  title: string;
  blocks: Prisma.InputJsonValue;
  blockOrder: Prisma.InputJsonValue;
  connectors: Prisma.InputJsonValue;
  camera: Prisma.InputJsonValue;
  frames?: Prisma.InputJsonValue;
  treeLayoutDirection?: string;
  treeGrowthMode?: string;
  treeLayoutFamily?: string;
  treeTimelineBranchMode?: string;
  treeTimelineDescendantStyle?: string;
  treeCatalogDescendantStyle?: string;
}

export type BoardCommitOutcome =
  | { board: WorkspaceBoard }
  | { stale: true; revision: number }
  | { gone: true };

export interface BoardCommitInput {
  boardId: string;
  /** Server-verified identity. The owner of a board being created, and the
   *  actor recorded against every edit event either way — never client-
   *  claimed, on either caller's path. */
  actorEmail: string;
  content: BoardContent;
  editEvents: Prisma.WorkspaceBoardEditEventCreateManyInput[];
  /** The revision this content was built on. Required for an update; ignored
   *  when the board does not exist yet. */
  baseRevision: number | null;
  /** Passed in rather than re-read: the caller has already loaded it to
   *  resolve access, and reading it twice invites the two reads to disagree. */
  existing: WorkspaceBoard | null;
  /** Version restore already has an explicit history row and must not create
   *  a second automatic snapshot as a side effect. */
  skipAutoCheckpoint?: boolean;
  writeCommandReceipt?: (tx: Prisma.TransactionClient, board: WorkspaceBoard) => Promise<void>;
  writeAgentHistory?: (tx: Prisma.TransactionClient) => Promise<void>;
  beforeBoardCommit?: (tx: Prisma.TransactionClient) => Promise<void>;
}

/**
 * Writes the content, then does the work that belongs with a successful write.
 * Returns `stale` when the stored revision has moved on — never a partial
 * write, and never a silent overwrite.
 */
export async function commitBoardContent(input: BoardCommitInput): Promise<BoardCommitOutcome> {
  const { boardId, actorEmail, content, editEvents, baseRevision, existing } = input;

  const outcome = await prisma.$transaction(async (tx) => {
    if (input.beforeBoardCommit) await input.beforeBoardCommit(tx);
    if (!existing) {
      let created: WorkspaceBoard;
      try {
        created = await tx.workspaceBoard.create({
          data: { id: boardId, ownerEmail: actorEmail, ...content },
        });
      } catch (err) {
        // Two first-time creates for the same client-generated board id (a
        // double-submitted create, or a retried request after a timed-out
        // first attempt that actually succeeded) can both pass the caller's
        // "does this exist yet" check before either INSERT lands — the loser
        // hits a unique-constraint violation here rather than an update
        // conflict. Treat it the same as a stale revision: the caller
        // already knows how to reload and retry from the now-current row,
        // instead of surfacing a raw 500. Scoped to just this INSERT (not
        // the editEvents createMany below) so an unrelated P2002 elsewhere
        // in the transaction still surfaces as a real error instead of
        // being misreported as "board already exists".
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          return { stale: true as const };
        }
        throw err;
      }
      if (editEvents.length > 0) await tx.workspaceBoardEditEvent.createMany({ data: editEvents });
      if (input.writeCommandReceipt) await input.writeCommandReceipt(tx, created);
      if (input.writeAgentHistory) await input.writeAgentHistory(tx);
      return { board: created };
    }
    // Compare-and-swap in ONE statement rather than read-then-write: matching
    // on the revision inside the same UPDATE is what makes this race-free.
    // A check performed before the write would let two savers who both read
    // revision 7 both pass it, which is the bug wearing a seatbelt.
    const applied = await tx.workspaceBoard.updateMany({
      where: { id: boardId, revision: baseRevision as number },
      data: { ...content, revision: { increment: 1 } },
    });
    if (applied.count === 0) return { stale: true as const };
    if (editEvents.length > 0) await tx.workspaceBoardEditEvent.createMany({ data: editEvents });
    const committed = await tx.workspaceBoard.findUnique({ where: { id: boardId } });
    if (!committed) throw new Error("Committed Workspace board disappeared inside transaction");
    if (input.writeCommandReceipt) await input.writeCommandReceipt(tx, committed);
    if (input.writeAgentHistory) await input.writeAgentHistory(tx);
    return { board: committed };
  });

  if ("stale" in outcome) {
    // The current revision goes back so the caller can reload from it instead
    // of retrying the same superseded write. Deliberately NOT auto-retried
    // anywhere: retrying with fresh content is precisely the overwrite this
    // refusal exists to prevent.
    const current = await prisma.workspaceBoard.findUnique({ where: { id: boardId } });
    if (!current) return { gone: true };
    return { stale: true, revision: current.revision };
  }

  // A time-bounded automatic checkpoint, so a later "restore" always has an
  // intermediate point to come back to instead of only whatever the user last
  // clicked "save version" on. Awaited but never able to fail the save — see
  // lib/workspace/autoCheckpoint.ts.
  if (!input.skipAutoCheckpoint) {
    await maybeWriteAutoCheckpoint(
      boardId,
      { blocks: content.blocks, blockOrder: content.blockOrder, connectors: content.connectors },
      actorEmail,
    );
  }

  // Keeps search finding what is written on the board, not only the files
  // uploaded to it. Awaited so full-text is correct as soon as this responds,
  // but never allowed to fail the save: the board is the user's work and the
  // index is derived from it. Losing a save to a transient index error would
  // be the worse trade by a wide margin, and the resync diffs against what is
  // stored, so the next save of this board re-attempts whatever did not land
  // — it heals rather than drifting. Logged rather than swallowed, because a
  // silent divergence is the failure mode this whole audit kept finding.
  try {
    await syncBlockChunksFromBoard(boardId, content.blocks);
  } catch (error) {
    console.warn("[workspace knowledge] block chunk resync failed", error);
  }

  return { board: outcome.board as WorkspaceBoard };
}
