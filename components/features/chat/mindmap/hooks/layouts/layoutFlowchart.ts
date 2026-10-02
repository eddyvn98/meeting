import { MindmapNode, StylePreset, PositionedNode, ConnectionPath } from "../../mindmap-types";
import { getDims } from "./layoutShared";

export function layoutFlowchart(
	tree: MindmapNode,
	activePreset: StylePreset,
	subOption: number,
	nodeWidth: number,
	nodeHeight: number,
	xGap: number,
	yGap: number,
	collapsedIds?: Set<string>
): { positioned: PositionedNode[]; connections: ConnectionPath[] } {
	const positioned: PositionedNode[] = [];
	const connections: ConnectionPath[] = [];
	const columnGap = xGap * 1.5;
	const rowGap = yGap * 1.5;

	const subtreeHeights: Record<string, number> = {};
	const calcHeight = (n: MindmapNode): number => {
		const dims = getDims(n, nodeWidth, nodeHeight);
		const isCollapsed = collapsedIds ? collapsedIds.has(n.id) : n.expanded === false;
		if (isCollapsed || !n.children || n.children.length === 0) {
			subtreeHeights[n.id] = dims.height;
			return dims.height;
		}
		const h = n.children.reduce((sum, child) => sum + calcHeight(child), 0) + (n.children.length - 1) * rowGap;
		subtreeHeights[n.id] = Math.max(dims.height, h);
		return subtreeHeights[n.id];
	};
	calcHeight(tree);

	// Max node width at each depth level, so every branch's children column
	// starts clear of the WIDEST node anywhere at the parent level — without
	// this, a long-content sibling elsewhere at that level can be wider than
	// the current node's own box and intrude into a neighboring branch's
	// children column (both share roughly the same Y range).
	const maxWidthByLevel: number[] = [];
	const collectWidths = (n: MindmapNode, level: number) => {
		const dims = getDims(n, nodeWidth, nodeHeight);
		maxWidthByLevel[level] = Math.max(maxWidthByLevel[level] ?? 0, dims.width);
		const isCollapsed = collapsedIds ? collapsedIds.has(n.id) : n.expanded === false;
		if (!isCollapsed && n.children) {
			n.children.forEach((c) => collectWidths(c, level + 1));
		}
	};
	collectWidths(tree, 0);

	const columnXByLevel: number[] = [40];
	for (let lvl = 1; lvl < maxWidthByLevel.length; lvl++) {
		columnXByLevel[lvl] = columnXByLevel[lvl - 1] + maxWidthByLevel[lvl - 1] + columnGap;
	}

	const traverse = (n: MindmapNode, level: number, topY: number, branchColor: string) => {
		const dims = getDims(n, nodeWidth, nodeHeight);
		const isCollapsed = collapsedIds ? collapsedIds.has(n.id) : n.expanded === false;
		const totalH = subtreeHeights[n.id];
		const y = topY + totalH / 2;
		const x = columnXByLevel[level];

		positioned.push({
			node: n, id: n.id, topic: n.topic,
			x, y,
			width: dims.width, height: dims.height,
			level, branchColor, direction: "right",
		});

		if (!isCollapsed && n.children && n.children.length > 0) {
			const childX = columnXByLevel[level + 1];
			let childTopY = topY + (totalH - subtreeHeights[n.children[0].id]) / 2;

			n.children.forEach((child, index) => {
				const childColor = level === 0 ? activePreset.branchColors[index % activePreset.branchColors.length] : branchColor;
				const childH = subtreeHeights[child.id];
				traverse(child, level + 1, childTopY, childColor);

				const sX = x + dims.width;
				const sY = y;
				const eX = childX;
				const eY = childTopY + childH / 2;

				const midX = sX + (eX - sX) / 2;
				const radius = subOption === 2 ? 10 : 0;
				const pathD = radius
					? `M ${sX} ${sY} H ${midX - radius} Q ${midX} ${sY} ${midX} ${sY + (eY > sY ? radius : -radius)} V ${eY - (eY > sY ? radius : -radius)} Q ${midX} ${eY} ${midX + radius} ${eY} H ${eX}`
					: `M ${sX} ${sY} H ${midX} V ${eY} H ${eX}`;

				connections.push({ id: `${n.id}-${child.id}`, d: pathD, color: childColor, arrowEnd: "arrow" });
				childTopY += childH + rowGap;
			});
		}
	};

	traverse(tree, 0, 40, activePreset.branchColors[0]);
	return { positioned, connections };
}
