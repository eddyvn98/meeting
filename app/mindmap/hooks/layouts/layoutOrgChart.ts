"use client";

import { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import {
	PositionedNode, ConnectionPath,
	pushNode, bezierV,
	X_GAP, Y_GAP,
	getNodeDimensions, getBranchColor,
} from "./layoutHelpers";
import {
	CATALOG_ROOT_RAIL_X, CATALOG_ROW_GAP,
	computeCatalogLevelOffsets, computeCatalogLevelWidths,
} from "./catalogColumns";

// Row Y-positions are keyed by depth rather than accumulated per-branch so every
// node at the same level lines up horizontally (the org-chart convention). Each
// row's height must be the tallest node at that depth across the whole tree —
// using the fixed NODE_HEIGHT constant here would let wrapped, multi-line
// content overflow into the next row and throw off every connector below it.
function computeOrgLevelHeights(node: MindmapNode, level: number, out: Record<number, number>) {
	const { height } = getNodeDimensions(node);
	out[level] = Math.max(out[level] ?? 0, height);
	if (node.expanded === false || !node.children?.length) return;
	node.children.forEach((child) => computeOrgLevelHeights(child, level + 1, out));
}

function computeOrgLevelOffsets(levelHeights: Record<number, number>, startY: number) {
	const offsets: Record<number, number> = {};
	let cursor = startY;
	Object.keys(levelHeights).map(Number).sort((a, b) => a - b).forEach((level) => {
		offsets[level] = cursor + levelHeights[level] / 2;
		cursor += levelHeights[level] + Y_GAP * 3;
	});
	return offsets;
}

export function runLayoutOrg(
	n: MindmapNode,
	level: number,
	centerX: number,
	color: string,
	activeColors: string[],
	subtreeWidths: Record<string, number>,
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	positionedById: Map<string, PositionedNode>,
	startY: number = 40,
	levelOffsets?: Record<number, number>
) {
	const offsets = levelOffsets ?? (() => {
		const levelHeights: Record<number, number> = {};
		computeOrgLevelHeights(n, 0, levelHeights);
		return computeOrgLevelOffsets(levelHeights, startY);
	})();
	const collapsed = n.expanded === false;
	const { width, height } = getNodeDimensions(n);
	const x = centerX - width / 2;
	const y = offsets[level];
	pushNode(positioned, n, level, x, y, color, positionedById);
	if (!collapsed && n.children?.length) {
		const totalW = subtreeWidths[n.id];
		let childCX = centerX - totalW / 2;
		n.children.forEach((child) => {
			const cc = activeColors[(level + 1) % activeColors.length];
			childCX += subtreeWidths[child.id] / 2;
			runLayoutOrg(child, level + 1, childCX, cc, activeColors, subtreeWidths, positioned, connections, positionedById, startY, offsets);
			const { height: childHeight } = getNodeDimensions(child);
			connections.push({ id: `${n.id}-${child.id}`, d: bezierV(centerX, y + height / 2, childCX, offsets[level + 1] - childHeight / 2), color: cc });
			childCX += subtreeWidths[child.id] / 2 + X_GAP;
		});
	}
}

export function runLayoutCatalog(
	n: MindmapNode,
	level: number,
	color: string,
	activeColors: string[],
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	catalogYRef: { value: number },
	positionedById: Map<string, PositionedNode>,
	parentId?: string,
	levelOffsets?: Record<number, number>
) {
	const offsets = levelOffsets ?? (() => {
		const levelWidths: Record<number, number> = {};
		computeCatalogLevelWidths(n, level, levelWidths);
		return computeCatalogLevelOffsets(levelWidths, CATALOG_ROOT_RAIL_X);
	})();
	const collapsed = n.expanded === false;
	const { height } = getNodeDimensions(n);
	const par = parentId ? positionedById.get(parentId) : undefined;
	// Every node at this depth shares one column (offsets[level]) so the whole
	// level lines up in a straight vertical band, sized off the widest label
	// at that depth. The connector's horizontal tick still starts at this
	// node's own parent's real edge, so it's short for a wide parent and
	// longer for a narrow one — but the column itself never moves.
	const x = offsets[level];
	const y = catalogYRef.value + height / 2;
	pushNode(positioned, n, level, x, y, color, positionedById);
	if (par) {
		const parDims = getNodeDimensions(par.node);
		const railX = par.x + parDims.width / 2;
		connections.push({ id: `${parentId}-${n.id}`, d: `M ${railX} ${par.y + parDims.height / 2} L ${railX} ${y} L ${x} ${y}`, color });
	}
	// A full standard-node-height gap (not just a thin Y_GAP sliver) keeps rows
	// from crowding together — cramped rows are also what made a marquee box
	// easy to mis-hit a neighboring row's connector.
	catalogYRef.value += height + CATALOG_ROW_GAP;
	if (!collapsed && n.children?.length) {
		n.children.forEach((child) => {
			const cc = activeColors[(level + 1) % activeColors.length];
			runLayoutCatalog(child, level + 1, cc, activeColors, positioned, connections, catalogYRef, positionedById, n.id, offsets);
		});
	}
}

export function runLayoutMindmapVertical(
	tree: MindmapNode,
	activeColors: string[],
	subtreeWidths: Record<string, number>,
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	positionedById: Map<string, PositionedNode>,
	connectionStyle: "curved" | "orthogonal" | "straight" = "curved",
	startY: number = 40
) {
	const children = tree.expanded !== false ? tree.children || [] : [];
	const half = Math.ceil(children.length / 2);
	const bottomChildren = children.slice(0, half);
	const topChildren = children.slice(half);
	const branchGap = Y_GAP * 3;
	const rootX = 560;
	const branchExtent = (node: MindmapNode): number => {
		const { height } = getNodeDimensions(node);
		if (node.expanded === false || !node.children?.length) return height / 2;
		return height / 2 + branchGap + Math.max(...node.children.map(branchExtent));
	};
	const rootHeight = getNodeDimensions(tree).height;
	const topExtent = topChildren.length
		? rootHeight / 2 + branchGap + Math.max(...topChildren.map(branchExtent))
		: rootHeight / 2;
	const rootY = startY + topExtent;

	const connect = (
		parent: PositionedNode,
		child: PositionedNode,
		color: string,
		direction: 1 | -1,
	) => {
		const startX = parent.x + parent.width / 2;
		const startY = parent.y + direction * parent.height / 2;
		const endX = child.x + child.width / 2;
		const endY = child.y - direction * child.height / 2;
		const lineStyle = child.node.style?.lineType ?? connectionStyle;
		const d = lineStyle === "orthogonal"
			? `M ${startX} ${startY} V ${(startY + endY) / 2} H ${endX} V ${endY}`
			: lineStyle === "straight"
				? `M ${startX} ${startY} L ${endX} ${endY}`
				: bezierV(startX, startY, endX, endY);
		connections.push({ id: `${parent.id}-${child.id}`, d, color });
	};

	const layoutBranch = (
		node: MindmapNode,
		level: number,
		centerX: number,
		centerY: number,
		color: string,
		direction: 1 | -1,
		parent?: PositionedNode,
	) => {
		const { width, height } = getNodeDimensions(node);
		const placed: PositionedNode = {
			node, id: node.id, topic: node.topic, x: centerX - width / 2, y: centerY,
			width, height, level, branchColor: color,
		};
		positioned.push(placed);
		positionedById.set(node.id, placed);
		if (parent) connect(parent, placed, color, direction);
		if (node.expanded === false || !node.children?.length) return;

		const totalWidth = node.children.reduce((sum, child) => sum + subtreeWidths[child.id], 0)
			+ Math.max(0, node.children.length - 1) * X_GAP;
		let childCenterX = centerX - totalWidth / 2;
		node.children.forEach((child) => {
			const childWidth = subtreeWidths[child.id];
			const childHeight = getNodeDimensions(child).height;
			childCenterX += childWidth / 2;
			const childCenterY = centerY + direction * (height / 2 + branchGap + childHeight / 2);
			layoutBranch(
				child,
				level + 1,
				childCenterX,
				childCenterY,
				getBranchColor(child, activeColors[(level + 1) % activeColors.length]),
				direction,
				placed,
			);
			childCenterX += childWidth / 2 + X_GAP;
		});
	};

	const rootWidth = getNodeDimensions(tree).width;
	const root: PositionedNode = {
		node: tree, id: tree.id, topic: tree.topic, x: rootX - rootWidth / 2, y: rootY,
		width: rootWidth, height: rootHeight, level: 0, branchColor: activeColors[0],
	};
	positioned.push(root);
	positionedById.set(tree.id, root);

	const layoutSide = (sideChildren: MindmapNode[], direction: 1 | -1) => {
		const totalWidth = sideChildren.reduce((sum, child) => sum + subtreeWidths[child.id], 0)
			+ Math.max(0, sideChildren.length - 1) * X_GAP;
		let childCenterX = rootX - totalWidth / 2;
		sideChildren.forEach((child) => {
			const childWidth = subtreeWidths[child.id];
			const childHeight = getNodeDimensions(child).height;
			childCenterX += childWidth / 2;
			layoutBranch(
				child,
				1,
				childCenterX,
				rootY + direction * (rootHeight / 2 + branchGap + childHeight / 2),
				getBranchColor(child, activeColors[1 % activeColors.length]),
				direction,
				root,
			);
			childCenterX += childWidth / 2 + X_GAP;
		});
	};

	layoutSide(bottomChildren, 1);
	layoutSide(topChildren, -1);
}
