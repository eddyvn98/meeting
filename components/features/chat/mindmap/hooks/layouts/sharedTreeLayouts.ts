// Single source of truth for the "mindmap" (radial split), "logical", and
// "org-chart" layout families used by BOTH the chat-inline preview
// (previewMindmap/previewLogical/previewOrgChart) and the preview card
// (cardMindmap/cardLogical/cardOrgChart). Those six files used to each carry
// a near-identical copy of this math — differing only in how a node's
// collapsed state is looked up — which meant a bug fixed in one silently
// stayed broken in the other five. `isCollapsed` abstracts that one
// difference so every caller shares this implementation instead.
import { MindmapNode, StylePreset, PositionedNode, ConnectionPath } from "../../mindmap-types";
import { growWidthForTopic, estimateContentHeight } from "../../mindmap-node-size";

export type IsCollapsed = (node: MindmapNode) => boolean;

function getDims(node: MindmapNode, baseWidth: number, baseHeight: number): { width: number; height: number } {
	const width = growWidthForTopic(node.topic, baseWidth);
	const availableTextWidth = width - 12;
	const height = estimateContentHeight(node.topic, node.description, availableTextWidth, baseHeight);
	return { width, height };
}

export function layoutMindmapCore(
	tree: MindmapNode,
	isCollapsed: IsCollapsed,
	activePreset: StylePreset,
	nodeWidth: number,
	nodeHeight: number,
	xGap: number,
	yGap: number,
	subOption: number = 1
): { positioned: PositionedNode[]; connections: ConnectionPath[] } {
	const positioned: PositionedNode[] = [];
	const connections: ConnectionPath[] = [];

	const subtreeHeights: Record<string, number> = {};
	const calculateHeights = (n: MindmapNode): number => {
		const dims = getDims(n, nodeWidth, nodeHeight);
		if (isCollapsed(n) || !n.children || n.children.length === 0) {
			subtreeHeights[n.id] = dims.height;
			return dims.height;
		}
		let h = 0;
		for (const child of n.children) h += calculateHeights(child);
		h += (n.children.length - 1) * yGap;
		subtreeHeights[n.id] = Math.max(dims.height, h);
		return subtreeHeights[n.id];
	};
	calculateHeights(tree);

	const rootDims = getDims(tree, nodeWidth, nodeHeight);
	const rightChildren = tree.children.filter((_, idx) => idx % 2 === 0);
	const leftChildren = tree.children.filter((_, idx) => idx % 2 !== 0);

	const rightHeight = rightChildren.reduce((sum, c) => sum + subtreeHeights[c.id], 0) + (rightChildren.length - 1) * yGap;
	const leftHeight = leftChildren.reduce((sum, c) => sum + subtreeHeights[c.id], 0) + (leftChildren.length - 1) * yGap;

	const maxHeight = Math.max(rightHeight, leftHeight, rootDims.height) + 100;
	const centerY = maxHeight / 2;
	const rootX = 400;
	const rootY = centerY;

	positioned.push({
		node: tree,
		id: tree.id,
		topic: tree.topic,
		x: rootX,
		y: rootY + rootDims.height / 2,
		width: rootDims.width,
		height: rootDims.height,
		level: 0,
		branchColor: activePreset.branchColors[0],
		direction: "right",
	});

	const getMindmapPath = (sX: number, sY: number, eX: number, eY: number, dir: "left" | "right") => {
		if (subOption === 2) {
			const midX = dir === "right" ? sX + xGap / 2 : sX - xGap / 2;
			return `M ${sX} ${sY} H ${midX} V ${eY} H ${eX}`;
		} else if (subOption === 3) {
			return `M ${sX} ${sY} L ${eX} ${eY}`;
		} else if (subOption === 5) {
			const midX = dir === "right" ? sX + xGap / 4 : sX - xGap / 4;
			return `M ${sX} ${sY} L ${midX} ${eY} H ${eX}`;
		} else {
			const controlX1 = dir === "right" ? sX + xGap / 2 : sX - xGap / 2;
			const controlX2 = dir === "right" ? eX - xGap / 2 : eX + xGap / 2;
			return `M ${sX} ${sY} C ${controlX1} ${sY}, ${controlX2} ${eY}, ${eX} ${eY}`;
		}
	};

	const layoutRight = (n: MindmapNode, level: number, x: number, startY: number, color: string) => {
		const dims = getDims(n, nodeWidth, nodeHeight);
		const collapsed = isCollapsed(n);
		const totalH = subtreeHeights[n.id];
		const currentY = startY + totalH / 2;

		positioned.push({
			node: n, id: n.id, topic: n.topic,
			x, y: currentY, width: dims.width, height: dims.height,
			level, branchColor: color, direction: "right",
		});

		if (!collapsed && n.children && n.children.length > 0) {
			let nextY = startY;
			n.children.forEach((c) => {
				const cH = subtreeHeights[c.id];
				layoutRight(c, level + 1, x + dims.width + xGap, nextY, color);
				const sX = x + dims.width, sY = currentY;
				const eX = x + dims.width + xGap, eY = nextY + cH / 2;
				connections.push({
					id: `${n.id}-${c.id}`,
					d: getMindmapPath(sX, sY, eX, eY, "right"),
					color,
				});
				nextY += cH + yGap;
			});
		}
	};

	const layoutLeft = (n: MindmapNode, level: number, x: number, startY: number, color: string) => {
		const dims = getDims(n, nodeWidth, nodeHeight);
		const collapsed = isCollapsed(n);
		const totalH = subtreeHeights[n.id];
		const currentY = startY + totalH / 2;

		positioned.push({
			node: n, id: n.id, topic: n.topic,
			x, y: currentY, width: dims.width, height: dims.height,
			level, branchColor: color, direction: "left",
		});

		if (!collapsed && n.children && n.children.length > 0) {
			let nextY = startY;
			n.children.forEach((c) => {
				const cH = subtreeHeights[c.id];
				const cDims = getDims(c, nodeWidth, nodeHeight);
				layoutLeft(c, level + 1, x - cDims.width - xGap, nextY, color);
				const sX = x, sY = currentY;
				const eX = x - xGap, eY = nextY + cH / 2;
				connections.push({
					id: `${n.id}-${c.id}`,
					d: getMindmapPath(sX, sY, eX, eY, "left"),
					color,
				});
				nextY += cH + yGap;
			});
		}
	};

	if (rightChildren.length > 0) {
		let rightYStart = centerY - rightHeight / 2;
		rightChildren.forEach((child, index) => {
			const childColor = activePreset.branchColors[(index * 2) % activePreset.branchColors.length];
			const childH = subtreeHeights[child.id];

			layoutRight(child, 1, rootX + rootDims.width + xGap, rightYStart, childColor);

			const sX = rootX + rootDims.width, sY = rootY + rootDims.height / 2;
			const eX = rootX + rootDims.width + xGap, eY = rightYStart + childH / 2;
			connections.push({
				id: `${tree.id}-${child.id}`,
				d: getMindmapPath(sX, sY, eX, eY, "right"),
				color: childColor,
			});
			rightYStart += childH + yGap;
		});
	}

	if (leftChildren.length > 0) {
		let leftYStart = centerY - leftHeight / 2;
		leftChildren.forEach((child, index) => {
			const childColor = activePreset.branchColors[(index * 2 + 1) % activePreset.branchColors.length];
			const childH = subtreeHeights[child.id];
			const childDims = getDims(child, nodeWidth, nodeHeight);

			layoutLeft(child, 1, rootX - childDims.width - xGap, leftYStart, childColor);

			const sX = rootX, sY = rootY + rootDims.height / 2;
			const eX = rootX - xGap, eY = leftYStart + childH / 2;
			connections.push({
				id: `${tree.id}-${child.id}`,
				d: getMindmapPath(sX, sY, eX, eY, "left"),
				color: childColor,
			});
			leftYStart += childH + yGap;
		});
	}

	return { positioned, connections };
}

export function layoutLogicalCore(
	tree: MindmapNode,
	isCollapsed: IsCollapsed,
	activePreset: StylePreset,
	layoutStructure: string,
	nodeWidth: number,
	nodeHeight: number,
	xGap: number,
	yGap: number,
	subOption: number = 1
): { positioned: PositionedNode[]; connections: ConnectionPath[] } {
	const positioned: PositionedNode[] = [];
	const connections: ConnectionPath[] = [];

	const subtreeHeights: Record<string, number> = {};
	const calculateHeights = (n: MindmapNode): number => {
		const dims = getDims(n, nodeWidth, nodeHeight);
		if (isCollapsed(n) || !n.children || n.children.length === 0) {
			subtreeHeights[n.id] = dims.height;
			return dims.height;
		}
		let h = 0;
		for (const child of n.children) h += calculateHeights(child);
		h += (n.children.length - 1) * yGap;
		subtreeHeights[n.id] = Math.max(dims.height, h);
		return subtreeHeights[n.id];
	};
	calculateHeights(tree);

	const layoutLR = (n: MindmapNode, level: number, x: number, startY: number, branchColor: string) => {
		const dims = getDims(n, nodeWidth, nodeHeight);
		const collapsed = isCollapsed(n);
		const totalH = subtreeHeights[n.id];
		const currentY = startY + totalH / 2;

		positioned.push({
			node: n, id: n.id, topic: n.topic,
			x, y: currentY, width: dims.width, height: dims.height,
			level, branchColor, direction: "right",
		});

		if (!collapsed && n.children && n.children.length > 0) {
			let childY = startY;
			n.children.forEach((child, index) => {
				const childColor = level === 0 ? activePreset.branchColors[index % activePreset.branchColors.length] : branchColor;
				const childH = subtreeHeights[child.id];

				layoutLR(child, level + 1, x + dims.width + xGap, childY, childColor);

				const startX = x + dims.width;
				const startYVal = currentY;
				const endX = x + dims.width + xGap;
				const endYVal = childY + childH / 2;

				let pathD = "";
				if (subOption === 2 || layoutStructure === "logical") {
					pathD = `M ${startX} ${startYVal} H ${startX + xGap / 2} V ${endYVal} H ${endX}`;
				} else if (subOption === 3 || layoutStructure === "skeleton") {
					pathD = `M ${startX} ${startYVal} L ${endX} ${endYVal}`;
				} else {
					const controlX1 = startX + xGap / 2;
					const controlX2 = endX - xGap / 2;
					pathD = `M ${startX} ${startYVal} C ${controlX1} ${startYVal}, ${controlX2} ${endYVal}, ${endX} ${endYVal}`;
				}

				connections.push({ id: `${n.id}-${child.id}`, d: pathD, color: childColor });
				childY += childH + yGap;
			});
		}
	};

	layoutLR(tree, 0, 40, 40, activePreset.branchColors[0]);
	return { positioned, connections };
}

export function layoutOrgChartCore(
	tree: MindmapNode,
	isCollapsed: IsCollapsed,
	activePreset: StylePreset,
	nodeWidth: number,
	nodeHeight: number,
	xGap: number,
	yGap: number,
	subOption: number = 1
): { positioned: PositionedNode[]; connections: ConnectionPath[] } {
	const positioned: PositionedNode[] = [];
	const connections: ConnectionPath[] = [];

	const subtreeWidths: Record<string, number> = {};
	const calculateWidths = (n: MindmapNode): number => {
		const dims = getDims(n, nodeWidth, nodeHeight);
		if (isCollapsed(n) || !n.children || n.children.length === 0) {
			subtreeWidths[n.id] = dims.width;
			return dims.width;
		}
		let w = 0;
		for (const child of n.children) w += calculateWidths(child);
		w += (n.children.length - 1) * xGap;
		subtreeWidths[n.id] = Math.max(dims.width, w);
		return subtreeWidths[n.id];
	};
	calculateWidths(tree);

	const layoutOrg = (n: MindmapNode, level: number, startX: number, y: number, branchColor: string) => {
		const dims = getDims(n, nodeWidth, nodeHeight);
		const collapsed = isCollapsed(n);
		const totalW = subtreeWidths[n.id];
		const currentX = startX + totalW / 2 - dims.width / 2;

		positioned.push({
			node: n, id: n.id, topic: n.topic,
			x: currentX, y: y + dims.height / 2, width: dims.width, height: dims.height,
			level, branchColor, direction: "right",
		});

		if (!collapsed && n.children && n.children.length > 0) {
			let childX = startX;
			const nextY = y + dims.height + yGap * 3.5;

			n.children.forEach((child, index) => {
				const childColor = level === 0 ? activePreset.branchColors[index % activePreset.branchColors.length] : branchColor;
				const childW = subtreeWidths[child.id];

				layoutOrg(child, level + 1, childX, nextY, childColor);

				const startPointX = currentX + dims.width / 2;
				const startPointY = y + dims.height;
				const endPointX = childX + childW / 2;
				const endPointY = nextY;
				const midY = startPointY + (nextY - startPointY) / 2;

				connections.push({
					id: `${n.id}-${child.id}`,
					d: subOption === 2
						? `M ${startPointX} ${startPointY} L ${endPointX} ${endPointY}`
						: `M ${startPointX} ${startPointY} V ${midY} H ${endPointX} V ${endPointY}`,
					color: childColor,
				});

				childX += childW + xGap;
			});
		}
	};

	layoutOrg(tree, 0, 40, 40, activePreset.branchColors[0]);
	return { positioned, connections };
}
