"use client";

import { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import { PositionedNode, ConnectionPath, pushNode, getNodeDimensions } from "./layoutHelpers";
import {
	CATALOG_ROOT_RAIL_X, CATALOG_ROW_GAP,
	catalogHierarchyRailX, computeCatalogLevelOffsets, computeCatalogLevelWidths,
} from "./catalogColumns";

/** How far a node's own band reaches above / below its center row. */
interface CatalogExtent {
	before: number;
	after: number;
}

// A hierarchy-style catalog centers a parent on its children's band, so a
// subtree needs vertical room on BOTH sides of its own row — unlike the stacked
// catalog, where every subtree only ever grows downward from its parent.
function calcCatalogExtents(node: MindmapNode, out: Record<string, CatalogExtent>): CatalogExtent {
	const ownHalf = getNodeDimensions(node).height / 2;
	const children = node.expanded === false ? [] : node.children ?? [];
	if (!children.length) {
		const leaf: CatalogExtent = { before: ownHalf, after: ownHalf };
		out[node.id] = leaf;
		return leaf;
	}
	let span = 0;
	children.forEach((child, index) => {
		const childExtent = calcCatalogExtents(child, out);
		span += childExtent.before + childExtent.after + (index ? CATALOG_ROW_GAP : 0);
	});
	// The parent sits on the band's midline, so each side has to clear half the
	// band — and at minimum the parent's own box.
	const half = Math.max(ownHalf, span / 2);
	const extent: CatalogExtent = { before: half, after: half };
	out[node.id] = extent;
	return extent;
}

function layoutBranch(
	node: MindmapNode,
	level: number,
	centerY: number,
	color: string,
	activeColors: string[],
	offsets: Record<number, number>,
	extents: Record<string, CatalogExtent>,
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	positionedById: Map<string, PositionedNode>,
) {
	const x = offsets[level];
	const { width } = getNodeDimensions(node);
	pushNode(positioned, node, level, x, centerY, color, positionedById);
	const children = node.expanded === false ? [] : node.children ?? [];
	if (!children.length) return;
	const childX = offsets[level + 1];
	const railX = catalogHierarchyRailX(childX);
	const span = children.reduce(
		(total, child, index) => total + extents[child.id].before + extents[child.id].after + (index ? CATALOG_ROW_GAP : 0),
		0,
	);
	let cursor = centerY - span / 2;
	children.forEach((child) => {
		const extent = extents[child.id];
		const childCenterY = cursor + extent.before;
		const childColor = activeColors[(level + 1) % activeColors.length];
		// Right edge of the parent → rail in the column gutter → left edge of
		// the child, the same bracket the Hierarchy layout draws.
		connections.push({
			id: `${node.id}-${child.id}`,
			d: `M ${x + width} ${centerY} L ${railX} ${centerY} L ${railX} ${childCenterY} L ${childX} ${childCenterY}`,
			color: childColor,
		});
		layoutBranch(child, level + 1, childCenterY, childColor, activeColors, offsets, extents, positioned, connections, positionedById);
		cursor = childCenterY + extent.after + CATALOG_ROW_GAP;
	});
}

/**
 * Treeview with hierarchy-style branches: the root still drops a spine to its
 * stacked level-1 rows (that column IS the treeview), but from level 1 down a
 * parent is centered on its children and the wire runs from its RIGHT edge to
 * the child's left edge instead of dropping from its bottom — the bracket shape
 * the Hierarchy layout uses. Columns stay shared per depth, so levels still
 * line up in straight vertical bands.
 *
 * Emitted in the canonical orientation only; the other three directions are
 * mirrors of it (see applyCanonicalLayoutMirrors).
 */
export function runLayoutCatalogHierarchy(
	root: MindmapNode,
	color: string,
	activeColors: string[],
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	catalogYRef: { value: number },
	positionedById: Map<string, PositionedNode>,
) {
	const levelWidths: Record<number, number> = {};
	computeCatalogLevelWidths(root, 0, levelWidths);
	const offsets = computeCatalogLevelOffsets(levelWidths, CATALOG_ROOT_RAIL_X);
	const extents: Record<string, CatalogExtent> = {};
	calcCatalogExtents(root, extents);

	const rootDims = getNodeDimensions(root);
	const rootY = catalogYRef.value + rootDims.height / 2;
	pushNode(positioned, root, 0, offsets[0], rootY, color, positionedById);
	const rootBottomY = rootY + rootDims.height / 2;
	catalogYRef.value = rootBottomY + CATALOG_ROW_GAP;

	const children = root.expanded === false ? [] : root.children ?? [];
	// The root→level-1 hop keeps the stacked catalog's bottom-center spine; only
	// an entry's OWN descendants switch to the centered bracket.
	const spineX = offsets[0] + rootDims.width / 2;
	children.forEach((child) => {
		const extent = extents[child.id];
		const childCenterY = catalogYRef.value + extent.before;
		const childColor = activeColors[1 % activeColors.length];
		connections.push({
			id: `${root.id}-${child.id}`,
			d: `M ${spineX} ${rootBottomY} L ${spineX} ${childCenterY} L ${offsets[1]} ${childCenterY}`,
			color: childColor,
		});
		layoutBranch(child, 1, childCenterY, childColor, activeColors, offsets, extents, positioned, connections, positionedById);
		catalogYRef.value = childCenterY + extent.after + CATALOG_ROW_GAP;
	});
}
