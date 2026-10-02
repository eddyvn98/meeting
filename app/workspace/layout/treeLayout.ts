/**
 * Pure tree auto-arrange layout (no React/store dependencies). See
 * CONTRACTS.md §24 — ports the old app's "hierarchy" layout family
 * (app/mindmap/hooks/layouts/layoutRight.ts's runLayoutRight, plus its
 * subtree-height computation in layoutHelpers.ts, generalized to the old
 * app's 4 map-level directions via mapLayoutConfig.ts's `MapLayoutDirection`):
 * same candidate calculation (subtree-size stacking, centered-on-parent),
 * same X_GAP/Y_GAP spacing constants, generalized from a fixed "grows right,
 * stacks vertically" axis to whichever of the 4 directions the board is set
 * to. The hierarchy path also supports the legacy "both-side" growth mode:
 * root children are split into two groups and laid out on mirrored directions.
 */

import type { BlockId } from "../types/block";

export const ALONG_GAP = 65;
export const CROSS_GAP = 14;

/** A block's `description` renders as a separate panel BELOW the block
 *  itself (BlockDescription.tsx, via BlockFrameOverlays.tsx), not inline
 *  inside the block's own box — unlike legacy Mindmap, which auto-sizes the
 *  node's own box to fit the description inline. The tree layout only knows
 *  each block's own w/h, so any layout size fed to computeTreeLayout must
 *  add this to a description-bearing block's height, or its panel visually
 *  overlaps whatever sibling/row CROSS_GAP (14px) placed right after it.
 *  A rough per-line estimate, not exact wrapping — generous enough to clear
 *  typical 1-3 sentence descriptions at the block's own width. */
export const DESCRIPTION_PANEL_EXTRA_HEIGHT = 90;

export type TreeDirection = "right" | "left" | "down" | "up";
export type TreeGrowthMode = "one-side" | "both-side";

// Legacy's vertical hierarchy (org-chart / mindmap-vertical) does NOT reuse
// X_GAP/Y_GAP verbatim on a swapped axis — it has its own dedicated pair:
// row separation (along the down/up growth axis) is Y_GAP*3 = 42px, and
// sibling spacing (across it) is X_GAP = 65px (app/mindmap/hooks/layouts/
// layoutOrgChart.ts). Using ALONG_GAP/CROSS_GAP unswapped for down/up gave
// the inverse: a 65px row gap and a cramped 14px sibling gap.
const VERTICAL_ALONG_GAP = 42;
const VERTICAL_CROSS_GAP = 65;

function axisGaps(direction: TreeDirection): { along: number; cross: number } {
  return isHorizontal(direction)
    ? { along: ALONG_GAP, cross: CROSS_GAP }
    : { along: VERTICAL_ALONG_GAP, cross: VERTICAL_CROSS_GAP };
}

export function mirrorDirection(direction: TreeDirection): TreeDirection {
  switch (direction) {
    case "right":
      return "left";
    case "left":
      return "right";
    case "down":
      return "up";
    case "up":
      return "down";
  }
}

export interface TreeLayoutSize {
  w: number;
  h: number;
}

export interface TreeLayoutPoint {
  x: number;
  y: number;
}

function isHorizontal(direction: TreeDirection): boolean {
  return direction === "right" || direction === "left";
}

/** A node's size along the growth axis (width for right/left, height for
 *  down/up) vs. across it (the axis siblings stack along). */
function axisSizes(direction: TreeDirection, size: TreeLayoutSize): { along: number; cross: number } {
  return isHorizontal(direction)
    ? { along: size.w, cross: size.h }
    : { along: size.h, cross: size.w };
}

function subtreeCross(
  id: BlockId,
  direction: TreeDirection,
  childrenByParent: Map<BlockId, BlockId[]>,
  sizes: Map<BlockId, TreeLayoutSize>,
  cache: Map<BlockId, number>,
): number {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;

  const crossGap = axisGaps(direction).cross;
  const children = childrenByParent.get(id) ?? [];
  const ownCross = axisSizes(direction, sizes.get(id) ?? { w: 160, h: 80 }).cross;
  const childrenCross = children.reduce((sum, childId) => sum + subtreeCross(childId, direction, childrenByParent, sizes, cache), 0)
    + Math.max(0, children.length - 1) * crossGap;
  // A resized parent still owns space in the cross-axis footprint. Without
  // this max, its descendants stay centred on the old footprint and every
  // connector has to bend around the enlarged node.
  const cross = children.length === 0 ? ownCross : Math.max(ownCross, childrenCross);

  cache.set(id, cross);
  return cross;
}

/** Top-left along-axis coordinate for a child placed after `parent`, given
 *  the growth direction — "right"/"down" grow from the parent's trailing
 *  edge; "left"/"up" grow backward from the parent's leading edge, so the
 *  child's own along-size has to be subtracted to keep it top-left anchored. */
function placeChildAlong(
  direction: TreeDirection,
  parentAlong: number,
  parentAlongSize: number,
  childAlongSize: number,
): number {
  const alongGap = axisGaps(direction).along;
  if (direction === "right" || direction === "down") {
    return parentAlong + parentAlongSize + alongGap;
  }
  return parentAlong - alongGap - childAlongSize;
}

function layoutSubtreeAxis(
  id: BlockId,
  along: number,
  crossStart: number,
  direction: TreeDirection,
  childrenByParent: Map<BlockId, BlockId[]>,
  sizes: Map<BlockId, TreeLayoutSize>,
  crosses: Map<BlockId, number>,
  out: Map<BlockId, { along: number; cross: number }>,
): void {
  const crossGap = axisGaps(direction).cross;
  const size = axisSizes(direction, sizes.get(id) ?? { w: 160, h: 80 });
  const totalCross = crosses.get(id) ?? size.cross;
  const centerCross = crossStart + totalCross / 2;
  out.set(id, { along, cross: centerCross - size.cross / 2 });

  const children = childrenByParent.get(id) ?? [];
  if (children.length === 0) return;

  const childrenCross = children.reduce((sum, childId) => sum + (crosses.get(childId) ?? 0), 0)
    + Math.max(0, children.length - 1) * crossGap;
  let childCrossStart = crossStart + Math.max(0, (totalCross - childrenCross) / 2);

  for (const childId of children) {
    const childSize = axisSizes(direction, sizes.get(childId) ?? { w: 160, h: 80 });
    const childAlong = placeChildAlong(direction, along, size.along, childSize.along);
    const childCross = crosses.get(childId) ?? 0;
    layoutSubtreeAxis(childId, childAlong, childCrossStart, direction, childrenByParent, sizes, crosses, out);
    childCrossStart += childCross + crossGap;
  }
}

/**
 * Computes {x, y} (top-left, matching Transform) for `rootId` and every
 * descendant reachable through `childrenByParent`, growing from
 * `rootX`/`rootY` in `direction`. `sizes` should hold each block's current
 * resolved w/h (missing entries default to 160×80).
 */
export function computeTreeLayout(
  rootId: BlockId,
  rootX: number,
  rootY: number,
  direction: TreeDirection,
  childrenByParent: Map<BlockId, BlockId[]>,
  sizes: Map<BlockId, TreeLayoutSize>,
  growthMode: TreeGrowthMode = "one-side",
): Map<BlockId, TreeLayoutPoint> {
  if (growthMode === "both-side") {
    const allChildren = childrenByParent.get(rootId) ?? [];
    if (allChildren.length >= 2) {
      const half = Math.ceil(allChildren.length / 2);
      const firstChildren = allChildren.slice(0, half);
      const secondChildren = allChildren.slice(half);

      const firstChildrenByParent = new Map(childrenByParent);
      firstChildrenByParent.set(rootId, firstChildren);
      const firstCrosses = new Map<BlockId, number>();
      subtreeCross(rootId, direction, firstChildrenByParent, sizes, firstCrosses);
      const firstAxisOut = new Map<BlockId, { along: number; cross: number }>();
      const rootAlong = isHorizontal(direction) ? rootX : rootY;
      const rootCross = isHorizontal(direction) ? rootY : rootX;

      const mirroredDir = mirrorDirection(direction);
      const secondChildrenByParent = new Map(childrenByParent);
      secondChildrenByParent.set(rootId, secondChildren);
      const secondCrosses = new Map<BlockId, number>();
      subtreeCross(rootId, mirroredDir, secondChildrenByParent, sizes, secondCrosses);
      const secondAxisOut = new Map<BlockId, { along: number; cross: number }>();

      // Both halves must hang off the SAME root centre line, the way legacy
      // aligns them (layoutRight.ts:149,152,180). layoutSubtreeAxis derives
      // the root's centre as `crossStart + totalCross / 2`, and each half has
      // its own totalCross — so passing the same crossStart to both (as this
      // used to) centred them on two different lines. With an uneven split
      // (say 3 heavy branches on one side, 2 light on the other) the heavier
      // fan drifted tens to hundreds of px off the root, and since the root's
      // own point is written by whichever half is applied last, the lighter
      // fan ended up visibly detached from it. Solving
      // `crossStart + totalCross / 2 = targetCentre` per half puts one root
      // centre on both.
      const firstTotalCross = firstCrosses.get(rootId) ?? 0;
      const secondTotalCross = secondCrosses.get(rootId) ?? 0;
      const targetCentre = rootCross + Math.max(firstTotalCross, secondTotalCross) / 2;

      layoutSubtreeAxis(rootId, rootAlong, targetCentre - firstTotalCross / 2, direction, firstChildrenByParent, sizes, firstCrosses, firstAxisOut);

      const rootAlongMirrored = isHorizontal(mirroredDir) ? rootX : rootY;
      layoutSubtreeAxis(rootId, rootAlongMirrored, targetCentre - secondTotalCross / 2, mirroredDir, secondChildrenByParent, sizes, secondCrosses, secondAxisOut);

      const out = new Map<BlockId, TreeLayoutPoint>();
      firstAxisOut.forEach((point, id) => {
        out.set(id, isHorizontal(direction)
          ? { x: point.along, y: point.cross }
          : { x: point.cross, y: point.along });
      });
      secondAxisOut.forEach((point, id) => {
        out.set(id, isHorizontal(mirroredDir)
          ? { x: point.along, y: point.cross }
          : { x: point.cross, y: point.along });
      });
      return out;
    }
  }

  const crosses = new Map<BlockId, number>();
  subtreeCross(rootId, direction, childrenByParent, sizes, crosses);

  const axisOut = new Map<BlockId, { along: number; cross: number }>();
  const rootAlong = isHorizontal(direction) ? rootX : rootY;
  const rootCross = isHorizontal(direction) ? rootY : rootX;
  layoutSubtreeAxis(rootId, rootAlong, rootCross, direction, childrenByParent, sizes, crosses, axisOut);

  const out = new Map<BlockId, TreeLayoutPoint>();
  axisOut.forEach((point, id) => {
    out.set(id, isHorizontal(direction)
      ? { x: point.along, y: point.cross }
      : { x: point.cross, y: point.along });
  });
  return out;
}
