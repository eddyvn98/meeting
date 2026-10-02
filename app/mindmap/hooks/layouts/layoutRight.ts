"use client";

import { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import {
	PositionedNode, ConnectionPath,
	pushNode, bezierH, bezierHLeft,
	NODE_WIDTH, X_GAP, Y_GAP,
	getNodeDimensions, getBranchColor,
} from "./layoutHelpers";

export function runLayoutRight(
	n: MindmapNode,
	level: number,
	x: number,
	startY: number,
	color: string,
	activeColors: string[],
	subtreeHeights: Record<string, number>,
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	positionedById: Map<string, PositionedNode>,
	connectionStyle: "curved" | "orthogonal" | "straight" = "curved"
) {
	const collapsed = n.expanded === false;
	const totalH = subtreeHeights[n.id];
	const cy = startY + totalH / 2;
	const effectiveColor = getBranchColor(n, color);
	pushNode(positioned, n, level, x, cy, effectiveColor, positionedById);

	const parentWidth = getNodeDimensions(n).width;

	if (!collapsed && n.children?.length) {
		const childrenHeight = n.children.reduce((sum, child) => sum + subtreeHeights[child.id], 0)
			+ Math.max(0, n.children.length - 1) * Y_GAP;
		// Center a shorter child group within a taller parent so a clear lane
		// does not look obstructed merely because the endpoints are misaligned.
		let childY = startY + Math.max(0, (totalH - childrenHeight) / 2);
		n.children.forEach((child) => {
			const cc = getBranchColor(child, activeColors[(level + 1) % activeColors.length]);
			const childH = subtreeHeights[child.id];
			runLayoutRight(child, level + 1, x + parentWidth + X_GAP, childY, cc, activeColors, subtreeHeights, positioned, connections, positionedById, connectionStyle);
			const ey = childY + childH / 2;

			const startX = x + parentWidth;
			const startYVal = cy;
			const endX = x + parentWidth + X_GAP;
			const endYVal = ey;

			const lineStyleType = child.style?.lineType ?? connectionStyle;

			let pathD = "";
			if (lineStyleType === "orthogonal") {
				pathD = `M ${startX} ${startYVal} H ${startX + X_GAP / 2} V ${endYVal} H ${endX}`;
			} else if (lineStyleType === "straight") {
				pathD = `M ${startX} ${startYVal} L ${endX} ${endYVal}`;
			} else {
				pathD = bezierH(startX, startYVal, endX, endYVal);
			}

			connections.push({ id: `${n.id}-${child.id}`, d: pathD, color: cc });
			childY += childH + Y_GAP;
		});
	}
}

export function runLayoutLeft(
	tree: MindmapNode,
	activeColors: string[],
	subtreeHeights: Record<string, number>,
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	positionedById: Map<string, PositionedNode>,
	connectionStyle: "curved" | "orthogonal" | "straight" = "curved",
	startY: number = 40
) {
	const tempConnections: ConnectionPath[] = [];
	runLayoutRight(tree, 0, 40, startY, activeColors[0], activeColors, subtreeHeights, positioned, tempConnections, positionedById, connectionStyle);

	const descendantIds = new Set<string>();
	const collectIds = (node: MindmapNode) => {
		descendantIds.add(node.id);
		if (node.children) {
			node.children.forEach(collectIds);
		}
	};
	collectIds(tree);

	const treeNodes = positioned.filter((p) => descendantIds.has(p.id));
	if (treeNodes.length > 0) {
		const maxX2 = Math.max(...treeNodes.map((p) => p.x + p.width));
		const minX2 = Math.min(...treeNodes.map((p) => p.x));
		treeNodes.forEach((p) => {
			p.x = minX2 + (maxX2 - p.x - p.width);
		});
	}

	const rebuildLeft = (n: MindmapNode, level: number) => {
		if (n.expanded === false || !n.children?.length) return;
		const par = positionedById.get(n.id)!;
		n.children.forEach((child) => {
			const cc = activeColors[(level + 1) % activeColors.length];
			const ch = positionedById.get(child.id)!;
			if (!ch) return;

			const startX = par.x;
			const startYVal = par.y;
			const endX = ch.x + ch.width;
			const endYVal = ch.y;

			const lineStyleType = child.style?.lineType ?? connectionStyle;

			let pathD = "";
			if (lineStyleType === "orthogonal") {
				pathD = `M ${startX} ${startYVal} H ${startX - X_GAP / 2} V ${endYVal} H ${endX}`;
			} else if (lineStyleType === "straight") {
				pathD = `M ${startX} ${startYVal} L ${endX} ${endYVal}`;
			} else {
				pathD = bezierHLeft(startX, startYVal, endX, endYVal);
			}

			connections.push({ id: `${n.id}-${child.id}`, d: pathD, color: cc });
			rebuildLeft(child, level + 1);
		});
	};
	rebuildLeft(tree, 0);
}

export function runLayoutMindmap(
	tree: MindmapNode,
	activeColors: string[],
	subtreeHeights: Record<string, number>,
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	positionedById: Map<string, PositionedNode>,
	connectionStyle: "curved" | "orthogonal" | "straight" = "curved",
	startY: number = 40
) {
	const children = tree.expanded !== false ? tree.children || [] : [];
	const half = Math.ceil(children.length / 2);
	const rH = children.slice(0, half).reduce((s, c) => s + subtreeHeights[c.id], 0) + Math.max(0, half - 1) * Y_GAP;
	const lH = children.slice(half).reduce((s, c) => s + subtreeHeights[c.id], 0) + Math.max(0, children.length - half - 1) * Y_GAP;

	const rootDims = getNodeDimensions(tree);
	const rootWidth = rootDims.width;
	const rootHeight = rootDims.height;

	const totalH = Math.max(rH, lH, rootHeight);
	const rootX = 560;
	const rootY = startY + totalH / 2;
	pushNode(positioned, tree, 0, rootX, rootY, activeColors[0], positionedById);

	let cy = rootY - rH / 2;
	children.slice(0, half).forEach((child) => {
		const cc = getBranchColor(child, activeColors[1 % activeColors.length]);
		const childH = subtreeHeights[child.id];
		runLayoutRight(child, 1, rootX + rootWidth + X_GAP, cy, cc, activeColors, subtreeHeights, positioned, connections, positionedById, connectionStyle);
		const ey = cy + childH / 2;

		const startX = rootX + rootWidth;
		const startYVal = rootY;
		const endX = rootX + rootWidth + X_GAP;
		const endYVal = ey;

		const lineStyleType = child.style?.lineType ?? connectionStyle;

		let pathD = "";
		if (lineStyleType === "orthogonal") {
			pathD = `M ${startX} ${startYVal} H ${startX + X_GAP / 2} V ${endYVal} H ${endX}`;
		} else if (lineStyleType === "straight") {
			pathD = `M ${startX} ${startYVal} L ${endX} ${endYVal}`;
		} else {
			pathD = bezierH(startX, startYVal, endX, endYVal);
		}

		connections.push({ id: `${tree.id}-${child.id}`, d: pathD, color: cc });
		cy += childH + Y_GAP;
	});

	const leftStart = positioned.length;
	cy = rootY - lH / 2;
	const tempConnections: ConnectionPath[] = [];
	children.slice(half).forEach((child) => {
		const cc = getBranchColor(child, activeColors[1 % activeColors.length]);
		const childH = subtreeHeights[child.id];
		runLayoutRight(child, 1, rootX + rootWidth + X_GAP, cy, cc, activeColors, subtreeHeights, positioned, tempConnections, positionedById, connectionStyle);
		cy += childH + Y_GAP;
	});

	for (let i = leftStart; i < positioned.length; i++) {
		const p = positioned[i];
		p.x = rootX - p.width - (p.x - rootX - rootWidth);
	}

	cy = rootY - lH / 2;
	children.slice(half).forEach((child) => {
		const cc = getBranchColor(child, activeColors[1 % activeColors.length]);
		const childH = subtreeHeights[child.id];
		const ey = cy + childH / 2;
		const childPos = positionedById.get(child.id)!;

		if (childPos) {
			const startX = rootX;
			const startYVal = rootY;
			const endX = childPos.x + childPos.width;
			const endYVal = ey;

			const lineStyleType = child.style?.lineType ?? connectionStyle;

			let pathD = "";
			if (lineStyleType === "orthogonal") {
				pathD = `M ${startX} ${startYVal} H ${startX - X_GAP / 2} V ${endYVal} H ${endX}`;
			} else if (lineStyleType === "straight") {
				pathD = `M ${startX} ${startYVal} L ${endX} ${endYVal}`;
			} else {
				pathD = bezierHLeft(startX, startYVal, endX, endYVal);
			}

			connections.push({ id: `${tree.id}-${child.id}`, d: pathD, color: cc });
		}

		const rebuildMirror = (n: MindmapNode, level: number) => {
			if (n.expanded === false || !n.children?.length) return;
			const par = positionedById.get(n.id)!;
			n.children.forEach((c2, i2) => {
				const cc2 = getBranchColor(c2, activeColors[(level + 1) % activeColors.length]);
				const ch = positionedById.get(c2.id)!;
				if (!ch || !par) return;

				const startX = par.x;
				const startYVal = par.y;
				const endX = ch.x + ch.width;
				const endYVal = ch.y;

				const lineStyleType = c2.style?.lineType ?? connectionStyle;

				let pathD = "";
				if (lineStyleType === "orthogonal") {
					pathD = `M ${startX} ${startYVal} H ${startX - X_GAP / 2} V ${endYVal} H ${endX}`;
				} else if (lineStyleType === "straight") {
					pathD = `M ${startX} ${startYVal} L ${endX} ${endYVal}`;
				} else {
					pathD = bezierHLeft(startX, startYVal, endX, endYVal);
				}

				connections.push({ id: `${n.id}-${c2.id}`, d: pathD, color: cc2 });
				rebuildMirror(c2, level + 1);
			});
		};
		rebuildMirror(child, 1);
		cy += childH + Y_GAP;
	});
}
