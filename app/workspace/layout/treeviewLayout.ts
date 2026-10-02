/**
 * Pure treeview (depth-column indented outline) auto-arrange layout.
 * See CONTRACTS.md §36 — ports the old app's "catalog" / "Treeview" family
 * (app/mindmap/hooks/layouts/catalogColumns.ts, layoutCatalogHierarchy.ts):
 *
 * Key structural characteristics:
 * 1. Depth-aligned vertical columns growing rightward from rootX:
 *    - Every node at depth N shares one vertical column sized to the widest label at that depth.
 *    - Columns separated by TREEVIEW_COLUMN_GAP (24px) gutters.
 * 2. Branch styles:
 *    - "stacked": DFS preorder top-to-bottom stack separated by rowGap (14px).
 *    - "hierarchy": Root stays stacked above level-1 rows, then deeper
 *      parents are centered vertically on their children's band with
 *      gutter-rail routing, matching the legacy catalog-hierarchy hybrid.
 * 3. Connection semantics:
 *    - Orthogonal elbow lines turning in the inter-column gutter rail.
 */

import type { BlockId } from "../types/block";
import { type TreeDirection, type TreeLayoutPoint, type TreeLayoutSize } from "./treeLayout";
import { orientTreeviewLayout } from "./treeviewOrientation";

export const TREEVIEW_COLUMN_GAP = 24;
// Legacy CATALOG_ROW_GAP (catalogColumns.ts) = NODE_HEIGHT (36px), reused
// as-is for both stacked rows and hierarchy bands — not CROSS_GAP/Y_GAP
// (14px), which belongs to the unrelated hierarchy/tree family.
export const TREEVIEW_ROW_GAP = 36;
const DEFAULT_SIZE: TreeLayoutSize = { w: 160, h: 80 };

export type TreeLayoutFamily =
  | "hierarchy"
  | "treeview"
  | "orgchart"
  | "timeline"
  | "fishbone"
  | "flowchart"
  | "swimlane";
export type TreeviewBranchStyle = "stacked" | "hierarchy";

export interface TreeviewLayoutOptions {
  style?: TreeviewBranchStyle;
  direction?: TreeDirection;
  columnGap?: number;
  rowGap?: number;
}

export interface TreeviewConnectionSpec {
  id: string;
  fromBlockId: BlockId;
  toBlockId: BlockId;
  fromSide: "right" | "bottom";
  toSide: "left";
  lineType: "orthogonal";
  railX?: number;
}

interface TreeviewExtent {
  before: number;
  after: number;
}

function calcHierarchyExtents(
  nodeId: BlockId,
  childrenByParent: Map<BlockId, BlockId[]>,
  sizes: Map<BlockId, TreeLayoutSize>,
  rowGap: number,
  out: Map<BlockId, TreeviewExtent>,
  visited: Set<BlockId>,
): TreeviewExtent {
  if (visited.has(nodeId)) {
    return out.get(nodeId) ?? { before: DEFAULT_SIZE.h / 2, after: DEFAULT_SIZE.h / 2 };
  }
  visited.add(nodeId);

  const size = sizes.get(nodeId) ?? DEFAULT_SIZE;
  const ownHalf = size.h / 2;
  const children = childrenByParent.get(nodeId) ?? [];
  if (children.length === 0) {
    const leaf = { before: ownHalf, after: ownHalf };
    out.set(nodeId, leaf);
    return leaf;
  }

  let span = 0;
  children.forEach((childId, index) => {
    const childExtent = calcHierarchyExtents(childId, childrenByParent, sizes, rowGap, out, visited);
    span += childExtent.before + childExtent.after + (index > 0 ? rowGap : 0);
  });

  const half = Math.max(ownHalf, span / 2);
  const extent = { before: half, after: half };
  out.set(nodeId, extent);
  return extent;
}

function layoutHierarchyTree(
  nodeId: BlockId,
  depth: number,
  centerY: number,
  depthOffsets: Map<number, number>,
  rootX: number,
  sizes: Map<BlockId, TreeLayoutSize>,
  childrenByParent: Map<BlockId, BlockId[]>,
  extents: Map<BlockId, TreeviewExtent>,
  rowGap: number,
  result: Map<BlockId, TreeLayoutPoint>,
  visited: Set<BlockId>,
): void {
  if (visited.has(nodeId)) return;
  visited.add(nodeId);

  const size = sizes.get(nodeId) ?? DEFAULT_SIZE;
  const x = depthOffsets.get(depth) ?? rootX;
  const y = centerY - size.h / 2;
  result.set(nodeId, { x, y });

  const children = childrenByParent.get(nodeId) ?? [];
  if (children.length === 0) return;

  const span = children.reduce((total, childId, index) => {
    const ext = extents.get(childId) ?? { before: DEFAULT_SIZE.h / 2, after: DEFAULT_SIZE.h / 2 };
    return total + ext.before + ext.after + (index > 0 ? rowGap : 0);
  }, 0);

  let childCursor = centerY - span / 2;
  for (const childId of children) {
    const ext = extents.get(childId) ?? { before: DEFAULT_SIZE.h / 2, after: DEFAULT_SIZE.h / 2 };
    const childCenterY = childCursor + ext.before;
    layoutHierarchyTree(
      childId,
      depth + 1,
      childCenterY,
      depthOffsets,
      rootX,
      sizes,
      childrenByParent,
      extents,
      rowGap,
      result,
      visited,
    );
    childCursor = childCenterY + ext.after + rowGap;
  }
}

/**
 * Computes {x, y} coordinates for a treeview (depth-column) layout.
 */
export function computeTreeviewLayout(
  rootId: BlockId,
  rootX: number,
  rootY: number,
  childrenByParent: Map<BlockId, BlockId[]>,
  sizes: Map<BlockId, TreeLayoutSize>,
  options: TreeviewLayoutOptions = {},
): Map<BlockId, TreeLayoutPoint> {
  const columnGap = options.columnGap ?? TREEVIEW_COLUMN_GAP;
  const style = options.style ?? "stacked";
  const rowGap = options.rowGap ?? TREEVIEW_ROW_GAP;

  const depthWidths = new Map<number, number>();
  const visited = new Set<BlockId>();

  function measureDepths(nodeId: BlockId, depth: number): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const size = sizes.get(nodeId) ?? DEFAULT_SIZE;
    const currentMax = depthWidths.get(depth) ?? 0;
    if (size.w > currentMax) {
      depthWidths.set(depth, size.w);
    }

    const children = childrenByParent.get(nodeId) ?? [];
    for (const childId of children) {
      measureDepths(childId, depth + 1);
    }
  }

  measureDepths(rootId, 0);

  const depthOffsets = new Map<number, number>();
  depthOffsets.set(0, rootX);

  const sortedDepths = Array.from(depthWidths.keys()).sort((a, b) => a - b);
  const maxDepth = sortedDepths.length > 0 ? sortedDepths[sortedDepths.length - 1] : 0;
  for (let d = 1; d <= maxDepth; d++) {
    const prevX = depthOffsets.get(d - 1) ?? rootX;
    const prevWidth = depthWidths.get(d - 1) ?? DEFAULT_SIZE.w;
    depthOffsets.set(d, prevX + prevWidth + columnGap);
  }

  const result = new Map<BlockId, TreeLayoutPoint>();

  if (style === "hierarchy") {
    const extents = new Map<BlockId, TreeviewExtent>();
    calcHierarchyExtents(rootId, childrenByParent, sizes, rowGap, extents, new Set());

    const rootSize = sizes.get(rootId) ?? DEFAULT_SIZE;
    result.set(rootId, { x: rootX, y: rootY });

    const children = childrenByParent.get(rootId) ?? [];
    let cursorY = rootY + rootSize.h + rowGap;
    const visited = new Set<BlockId>([rootId]);
    for (const childId of children) {
      const ext = extents.get(childId) ?? { before: DEFAULT_SIZE.h / 2, after: DEFAULT_SIZE.h / 2 };
      const childCenterY = cursorY + ext.before;
      layoutHierarchyTree(
        childId,
        1,
        childCenterY,
        depthOffsets,
        rootX,
        sizes,
        childrenByParent,
        extents,
        rowGap,
        result,
        visited,
      );
      cursorY = childCenterY + ext.after + rowGap;
    }
    return orientTreeviewLayout(result, rootId, rootX, rootY, sizes, options.direction ?? "right");
  }

  // Default "stacked" preorder layout
  let cursorY = rootY;
  const layoutVisited = new Set<BlockId>();

  function layoutNode(nodeId: BlockId, depth: number): void {
    if (layoutVisited.has(nodeId)) return;
    layoutVisited.add(nodeId);

    const size = sizes.get(nodeId) ?? DEFAULT_SIZE;
    const x = depthOffsets.get(depth) ?? rootX;
    const y = cursorY;
    result.set(nodeId, { x, y });
    cursorY += size.h + rowGap;

    const children = childrenByParent.get(nodeId) ?? [];
    for (const childId of children) {
      layoutNode(childId, depth + 1);
    }
  }

  layoutNode(rootId, 0);
  return orientTreeviewLayout(result, rootId, rootX, rootY, sizes, options.direction ?? "right");
}

/**
 * Computes connector specifications for treeview layouts (gutter rail orthogonal lines).
 */
export function computeTreeviewConnections(
  rootId: BlockId,
  childrenByParent: Map<BlockId, BlockId[]>,
): TreeviewConnectionSpec[] {
  const connections: TreeviewConnectionSpec[] = [];
  const visited = new Set<BlockId>();

  function walk(parentId: BlockId) {
    if (visited.has(parentId)) return;
    visited.add(parentId);

    const children = childrenByParent.get(parentId) ?? [];
    for (const childId of children) {
      connections.push({
        id: `${parentId}-${childId}`,
        fromBlockId: parentId,
        toBlockId: childId,
        fromSide: "right",
        toSide: "left",
        lineType: "orthogonal",
      });
      walk(childId);
    }
  }

  walk(rootId);
  return connections;
}
