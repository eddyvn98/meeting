import type { BlockId, CanvasBlock, MapLayoutSettings } from "../types/block";
import type { WorkspaceStore } from "../store/useWorkspaceStore";

export const DEFAULT_MAP_LAYOUT: MapLayoutSettings = {
  family: "hierarchy",
  direction: "right",
  growthMode: "one-side",
  connectorLineType: "curved",
  connectorPaletteId: "default",
  stylePresetId: "default",
  timelineBranchMode: "auto",
  timelineDescendantStyle: "tree",
  catalogDescendantStyle: "tree",
};

export function findMapRootId(blocks: Record<BlockId, CanvasBlock>, blockId: BlockId): BlockId | null {
  const block = blocks[blockId];
  if (!block) return null;

  // A free-form diagram cannot use parentId to express membership: a
  // flowchart node may have several incoming/outgoing connectors and a
  // swimlane step deliberately has no tree parent. Templates therefore carry
  // an explicit mapId, whose root is the block that owns mapLayout.
  if (block.mapId) {
    const mappedRoot = Object.values(blocks).find((candidate) =>
      candidate.mapId === block.mapId && candidate.mapLayout,
    );
    if (mappedRoot) return mappedRoot.id;
  }

  let current = blockId;
  for (let guard = 0; guard < 1000; guard += 1) {
    const parentId = blocks[current]?.parentId;
    if (!parentId || !blocks[parentId]) {
      // Keep legacy behavior for a standalone block: it is still the root of
      // its own one-block map until another block is attached. Explicit mapId
      // membership above continues to take precedence for free-form maps.
      return current;
    }
    current = parentId;
  }
  return current;
}

export function selectedMapRootId(state: Pick<WorkspaceStore, "blocks" | "selectedBlockIds">): BlockId | null {
  const roots = new Set(state.selectedBlockIds.map((id) => findMapRootId(state.blocks, id)).filter(Boolean));
  return roots.size === 1 ? [...roots][0] : null;
}

export function resolveMapLayout(root: CanvasBlock | undefined, fallback: MapLayoutSettings): MapLayoutSettings {
  return { ...fallback, ...(root?.mapLayout ?? {}) };
}

export function currentMapLayout(state: Pick<WorkspaceStore, "blocks" | "treeLayoutFamily" | "treeLayoutDirection" | "treeGrowthMode" | "treeConnectorLineType" | "treeConnectorPaletteId" | "treeTimelineBranchMode" | "treeTimelineDescendantStyle" | "treeCatalogDescendantStyle">, blockId: BlockId): MapLayoutSettings {
  const fallback: MapLayoutSettings = {
    ...DEFAULT_MAP_LAYOUT,
    family: state.treeLayoutFamily,
    direction: state.treeLayoutDirection,
    growthMode: state.treeGrowthMode,
    connectorLineType: state.treeConnectorLineType,
    connectorPaletteId: state.treeConnectorPaletteId,
    timelineBranchMode: state.treeTimelineBranchMode,
    timelineDescendantStyle: state.treeTimelineDescendantStyle,
    catalogDescendantStyle: state.treeCatalogDescendantStyle,
  };
  const rootId = findMapRootId(state.blocks, blockId);
  return resolveMapLayout(rootId ? state.blocks[rootId] : undefined, fallback);
}

export function blockIdsInMap(blocks: Record<BlockId, CanvasBlock>, rootId: BlockId): Set<BlockId> {
  const ids = new Set<BlockId>([rootId]);
  const mapId = blocks[rootId]?.mapId;
  if (mapId) {
    Object.values(blocks).forEach((block) => {
      if (block.mapId === mapId) ids.add(block.id);
    });
  }
  let changed = true;
  while (changed) {
    changed = false;
    Object.values(blocks).forEach((block) => {
      if (block.parentId && ids.has(block.parentId) && !ids.has(block.id)) {
        ids.add(block.id);
        changed = true;
      }
    });
  }
  return ids;
}
