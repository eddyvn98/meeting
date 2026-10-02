/**
 * lib/workspace/knowledge-block-chunks.ts
 *
 * Keeps the BLOCK-sourced knowledge chunks in step with the canvas, so a
 * search finds what is written on the board and not only the files uploaded
 * to it. Workspace twin of lib/mindmap/knowledge-node-chunks.ts.
 *
 * Two properties carried over deliberately, because both were learned the
 * expensive way on the legacy side:
 *
 *  - **Diff, do not rebuild.** Deleting every chunk and recreating it means
 *    re-embedding the whole board on every save — the single most expensive
 *    part of saving, entirely wasted for blocks whose text did not change —
 *    and it leaves the board with nothing searchable for the duration.
 *  - **The embedding write is guarded by the content it embedded.** Vector
 *    refresh runs after the save returns, so a slow embed of old text can
 *    still be in flight when newer text lands. Matching on content means the
 *    late writer updates nothing instead of overwriting the newer edit.
 *
 * No access check here: the only caller is the board write, which is already
 * behind one.
 */

import { prisma } from "@/lib/prisma";
import { embed } from "@/lib/embeddings";
import { collectBlockTexts } from "./knowledge-block-text";

/** Two at a time. The embedder is a local model; running the whole board at
 *  once starves the request handlers it shares a process with. */
const EMBEDDING_CONCURRENCY = 2;

interface ChangedChunk {
  blockId: string;
  content: string;
  chunkId?: string;
}

export async function syncBlockChunksFromBoard(boardId: string, blocks: unknown): Promise<void> {
  const wanted = collectBlockTexts(blocks);
  const stored = await prisma.workspaceKnowledgeChunk.findMany({
    where: { boardId, sourceType: "BLOCK" },
    select: { id: true, blockId: true, content: true },
  });

  const storedByBlockId = new Map<string, { id: string; content: string }>();
  const staleChunkIds: string[] = [];
  for (const chunk of stored) {
    // A chunk with no blockId has nothing to stay in sync with, and a second
    // chunk for one block means an older run left a duplicate — whichever of
    // the two is stale, keeping both makes the same text match twice and rank
    // itself up. Drop the extra.
    if (!chunk.blockId || storedByBlockId.has(chunk.blockId)) {
      staleChunkIds.push(chunk.id);
      continue;
    }
    storedByBlockId.set(chunk.blockId, { id: chunk.id, content: chunk.content });
  }

  // A block that was deleted, or whose text was cleared, must stop answering.
  for (const [blockId, existing] of storedByBlockId) {
    if (!wanted.has(blockId)) staleChunkIds.push(existing.id);
  }

  const toCreate: { blockId: string; content: string }[] = [];
  const toUpdate: { id: string; blockId: string; content: string }[] = [];
  for (const [blockId, content] of wanted) {
    const existing = storedByBlockId.get(blockId);
    if (!existing) toCreate.push({ blockId, content });
    else if (existing.content !== content) toUpdate.push({ id: existing.id, blockId, content });
  }

  if (!staleChunkIds.length && !toCreate.length && !toUpdate.length) return;

  await prisma.$transaction(async (tx) => {
    if (staleChunkIds.length) {
      await tx.workspaceKnowledgeChunk.deleteMany({ where: { id: { in: staleChunkIds } } });
    }
    if (toCreate.length) {
      await tx.workspaceKnowledgeChunk.createMany({
        data: toCreate.map((row) => ({
          boardId,
          sourceType: "BLOCK" as const,
          blockId: row.blockId,
          content: row.content,
          // Empty on purpose: full-text search is correct the moment this
          // transaction commits. The vector is refreshed afterwards rather
          // than holding up the save.
          embedding: [],
        })),
      });
    }
    for (const row of toUpdate) {
      // The old vector is cleared with the new content, so the chunk is never
      // findable by a vector that describes text it no longer holds.
      await tx.workspaceKnowledgeChunk.update({
        where: { id: row.id },
        data: { content: row.content, embedding: [] },
      });
    }
  });

  const changed: ChangedChunk[] = [
    ...toCreate,
    ...toUpdate.map(({ id: chunkId, blockId, content }) => ({ chunkId, blockId, content })),
  ];
  if (changed.length) {
    void refreshBlockChunkEmbeddings(boardId, changed).catch((error) => {
      console.warn("[workspace knowledge] block embedding refresh failed", error);
    });
  }
}

async function refreshBlockChunkEmbeddings(boardId: string, changed: ChangedChunk[]): Promise<void> {
  for (let offset = 0; offset < changed.length; offset += EMBEDDING_CONCURRENCY) {
    const batch = changed.slice(offset, offset + EMBEDDING_CONCURRENCY);
    await Promise.all(batch.map(async (row) => {
      const embedding = await embed(row.content).catch(() => null);
      if (!embedding?.length) return;

      // Matching on `content` is what makes a late embed harmless: if the
      // block has been edited again since, this updates nothing rather than
      // attaching a vector for text that is no longer there.
      await prisma.workspaceKnowledgeChunk.updateMany({
        where: {
          ...(row.chunkId ? { id: row.chunkId } : {}),
          boardId,
          sourceType: "BLOCK",
          blockId: row.blockId,
          content: row.content,
        },
        data: { embedding },
      });
    }));
  }
}
