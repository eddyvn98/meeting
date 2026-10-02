"use client";

import { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import { NODE_HEIGHT, getNodeDimensions } from "./layoutHelpers";

/** Canonical X of the root rail every catalog column is measured from. */
export const CATALOG_ROOT_RAIL_X = 160;
/** Gap between two adjacent catalog columns — see computeCatalogLevelOffsets. */
export const CATALOG_COLUMN_GAP = 24;
/** Vertical breathing room between two catalog rows (a full node height, not a
 *  thin Y_GAP sliver: cramped rows made a marquee box easy to mis-hit). */
export const CATALOG_ROW_GAP = NODE_HEIGHT;

// Every node at a given depth shares one column so each level lines up in a
// straight vertical band on screen, sized off the widest label at that depth —
// not each node's own immediate parent, which would indent a different amount
// per branch depending on that branch's label lengths.
export function computeCatalogLevelWidths(node: MindmapNode, level: number, out: Record<number, number>) {
	const { width } = getNodeDimensions(node);
	out[level] = Math.max(out[level] ?? 0, width);
	if (node.expanded === false || !node.children?.length) return;
	node.children.forEach((child) => computeCatalogLevelWidths(child, level + 1, out));
}

export function computeCatalogLevelOffsets(levelWidths: Record<number, number>, rootRailX: number) {
	const offsets: Record<number, number> = {};
	let cursor = rootRailX - levelWidths[0] / 2;
	Object.keys(levelWidths).map(Number).sort((a, b) => a - b).forEach((level) => {
		offsets[level] = cursor;
		// A slight gap, not the sibling-subtree X_GAP(65) — this indent only
		// needs to clear the widest label at this depth, not separate two
		// side-by-side branches.
		cursor += levelWidths[level] + CATALOG_COLUMN_GAP;
	});
	return offsets;
}

/** Where a hierarchy-style catalog parent's rail sits: in the gutter just left
 *  of the CHILD column, so the wire leaves the parent's right edge and enters
 *  the child's left edge. Keyed off the child column (not the parent's own
 *  width) so every fork at a depth shares one rail line. */
export function catalogHierarchyRailX(childX: number) {
	return childX - CATALOG_COLUMN_GAP / 2;
}
