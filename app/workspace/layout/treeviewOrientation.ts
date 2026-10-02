import type { BlockId } from "../types/block";
import { type TreeDirection, type TreeLayoutPoint, type TreeLayoutSize } from "./treeLayout";

const DEFAULT_SIZE: TreeLayoutSize = { w: 160, h: 80 };

// Legacy (app/mindmap/hooks/layouts/layoutMirror.ts, mirrorAxis) mirrors a
// catalog/treeview map via a PURE axis flip about the root's center, never a
// rotation: "left" flips the rail (x only), "up" flips the growth direction
// (y only), "down" flips both (a 180° point reflection, which is still a pure
// flip on each axis independently — not a dx/dy swap). Swapping dx/dy for
// up/down (a 90°-rotation shape) or negating both axes for "left" (a 180°
// rotation) scrambles the depth columns entirely: every node ends up at its
// own unique x instead of sharing its depth's column, which is what made
// deeper levels look "missing" (scattered far off the visible canvas) once a
// non-right direction was picked.
export function orientTreeviewLayout(
  result: Map<BlockId, TreeLayoutPoint>,
  rootId: BlockId,
  rootX: number,
  rootY: number,
  sizes: Map<BlockId, TreeLayoutSize>,
  direction: TreeDirection,
): Map<BlockId, TreeLayoutPoint> {
  if (direction === "right") return result;
  const rootSize = sizes.get(rootId) ?? DEFAULT_SIZE;
  const rootCenter = { x: rootX + rootSize.w / 2, y: rootY + rootSize.h / 2 };
  const flipX = direction === "left" || direction === "down";
  const flipY = direction === "up" || direction === "down";
  for (const [id, point] of result) {
    if (id === rootId) continue;
    const size = sizes.get(id) ?? DEFAULT_SIZE;
    const center = { x: point.x + size.w / 2, y: point.y + size.h / 2 };
    const next = {
      x: flipX ? rootCenter.x * 2 - center.x : center.x,
      y: flipY ? rootCenter.y * 2 - center.y : center.y,
    };
    result.set(id, { x: next.x - size.w / 2, y: next.y - size.h / 2 });
  }
  return result;
}
