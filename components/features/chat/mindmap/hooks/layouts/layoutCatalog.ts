import { MindmapNode, StylePreset, PositionedNode, ConnectionPath } from "../../mindmap-types";
import { getDims } from "./layoutShared";

export function layoutCatalog(
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

	let currentY = 40;
	const startX = 40;

	const traverse = (
		node: MindmapNode,
		level: number,
		parentX: number,
		parentY: number,
		parentId: string | null,
		branchColor: string
	) => {
		const isCollapsed = collapsedIds ? collapsedIds.has(node.id) : node.expanded === false;
		const dims = getDims(node, nodeWidth, nodeHeight);
		const x = startX + level * (nodeWidth + xGap);
		const y = currentY + dims.height / 2;

		positioned.push({
			node,
			id: node.id,
			topic: node.topic,
			x,
			y,
			width: dims.width,
			height: dims.height,
			level,
			branchColor,
			direction: "right",
		});

		if (parentId !== null) {
			const sX = parentX + 20; // Start slightly inset from parent's left
			const sY = parentY;
			const eX = x;
			const eY = y;
			let pathD = "";
			if (subOption === 1) {
				// Rounded orthogonal
				pathD = `M ${sX} ${sY} V ${eY - 8} Q ${sX} ${eY} ${sX + 8} ${eY} H ${eX}`;
			} else {
				// Sharp orthogonal
				pathD = `M ${sX} ${sY} V ${eY} H ${eX}`;
			}
			connections.push({
				id: `${parentId}-${node.id}`,
				d: pathD,
				color: branchColor,
			});
		}

		currentY += dims.height + yGap;

		if (!isCollapsed && node.children && node.children.length > 0) {
			node.children.forEach((child, index) => {
				const childColor =
					level === 0
						? activePreset.branchColors[index % activePreset.branchColors.length]
						: branchColor;
				traverse(child, level + 1, x, y, node.id, childColor);
			});
		}
	};

	traverse(tree, 0, startX, currentY, null, activePreset.branchColors[0]);
	return { positioned, connections };
}
