/**
 * Three-way merge used when a save is refused because another writer (a
 * person or the AI) moved the board on. `base` is the content this tab last
 * synced with the server, `mine` the local content, `theirs` the server's
 * current content.
 *
 * Per block/connector: an entity changed only locally keeps the local value,
 * one changed only on the server takes the server value, and one changed on
 * both sides keeps the server value and is counted as a conflict so the user
 * can be told. Nothing a person did is dropped without that being reported.
 */
export interface BoardContent {
  blocks: Record<string, unknown>;
  blockOrder: string[];
  connectors: Record<string, unknown>;
}

/** One entity both sides changed; `mine` is the local value that was not kept. */
export interface MergeConflictItem {
  kind: "block" | "connector";
  id: string;
  mine: unknown;
  theirs: unknown;
}

export interface MergedBoardContent extends BoardContent {
  conflicts: number;
  items: MergeConflictItem[];
}

// Key order is not stable across a Postgres JSONB round trip.
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : v);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

function mergeEntities(
  base: Record<string, unknown>,
  mine: Record<string, unknown>,
  theirs: Record<string, unknown>,
): { merged: Record<string, unknown>; conflicts: number; lost: Array<{ id: string; mine: unknown; theirs: unknown }> } {
  const merged: Record<string, unknown> = {};
  const lost: Array<{ id: string; mine: unknown; theirs: unknown }> = [];
  let conflicts = 0;
  for (const key of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
    const mineChanged = !same(mine[key], base[key]);
    const theirsChanged = !same(theirs[key], base[key]);
    let value: unknown;
    if (mineChanged && !theirsChanged) value = mine[key];
    else if (!mineChanged) value = theirs[key];
    else {
      value = theirs[key];
      if (!same(mine[key], theirs[key])) {
        conflicts += 1;
        lost.push({ id: key, mine: mine[key], theirs: theirs[key] });
      }
    }
    if (value !== undefined) merged[key] = value;
  }
  return { merged, conflicts, lost };
}

export function mergeBoardContent(base: BoardContent, mine: BoardContent, theirs: BoardContent): MergedBoardContent {
  const blocks = mergeEntities(base.blocks, mine.blocks, theirs.blocks);
  const connectors = mergeEntities(base.connectors, mine.connectors, theirs.connectors);
  // Server order first (it is the shared timeline), then blocks only this tab
  // created, in local order; anything that did not survive the merge is gone.
  const order = theirs.blockOrder.filter((id) => id in blocks.merged);
  for (const id of mine.blockOrder) {
    if (id in blocks.merged && !order.includes(id)) order.push(id);
  }
  for (const id of Object.keys(blocks.merged)) {
    if (!order.includes(id)) order.push(id);
  }
  return {
    blocks: blocks.merged,
    blockOrder: order,
    connectors: connectors.merged,
    conflicts: blocks.conflicts + connectors.conflicts,
    items: [
      ...blocks.lost.map((item) => ({ kind: "block" as const, ...item })),
      ...connectors.lost.map((item) => ({ kind: "connector" as const, ...item })),
    ],
  };
}
