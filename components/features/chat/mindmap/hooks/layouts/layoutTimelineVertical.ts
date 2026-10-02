import { MindmapNode, StylePreset, PositionedNode, ConnectionPath } from "../../mindmap-types";
import { getDims } from "./layoutShared";

export function layoutVerticalTimeline(
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

	const centerX = 400;
	const rootDims = getDims(tree, nodeWidth, nodeHeight);
	const rootX = centerX - rootDims.width / 2;
	const rootY = 40;

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

	const isCollapsed = collapsedIds ? collapsedIds.has(tree.id) : tree.expanded === false;
	if (isCollapsed || !tree.children || tree.children.length === 0) {
		return { positioned, connections };
	}

	let currentY = rootY + rootDims.height + yGap * 2.5;
	let maxLevel1Y = currentY;

	tree.children.forEach((child, index) => {
		const childColor = activePreset.branchColors[index % activePreset.branchColors.length];
		const childDims = getDims(child, nodeWidth, nodeHeight);

		let side: "left" | "right" = "right";
		if (subOption === 1) {
			side = index % 2 === 0 ? "right" : "left";
		} else if (subOption === 2) {
			side = "right";
		} else {
			side = "left";
		}

		const childX =
			side === "right" ? centerX + xGap * 1.5 : centerX - xGap * 1.5 - childDims.width;

		const subTreeNodes: PositionedNode[] = [];
		const subTreeConnections: ConnectionPath[] = [];

		const traverseDescendants = (
			node: MindmapNode,
			level: number,
			x: number,
			y: number,
			direction: "left" | "right",
			color: string
		) => {
			const dims = getDims(node, nodeWidth, nodeHeight);
			subTreeNodes.push({
				node,
				id: node.id,
				topic: node.topic,
				x,
				y,
				width: dims.width,
				height: dims.height,
				level,
				branchColor: color,
				direction,
			});

			const childIsCollapsed = collapsedIds ? collapsedIds.has(node.id) : node.expanded === false;
			if (!childIsCollapsed && node.children && node.children.length > 0) {
				// Edge this chain continues from — a wide (long-content) node needs
				// its own real width reserved before the next link starts.
				let cursorEdge = direction === "right" ? x + dims.width : x;

				node.children.forEach((c) => {
					const cDims = getDims(c, nodeWidth, nodeHeight);
					const nextX = direction === "right" ? cursorEdge + xGap : cursorEdge - xGap - cDims.width;

					traverseDescendants(c, level + 1, nextX, y, direction, color);

					const sX = direction === "right" ? x + dims.width : x;
					const eX = direction === "right" ? nextX : nextX + cDims.width;
					subTreeConnections.push({
						id: `${node.id}-${c.id}`,
						d: `M ${sX} ${y} H ${eX}`,
						color,
					});

					cursorEdge = direction === "right" ? nextX + cDims.width : nextX;
				});
			}
		};

		traverseDescendants(child, 1, childX, currentY + childDims.height / 2, side, childColor);

		positioned.push(...subTreeNodes);
		connections.push(...subTreeConnections);

		const axisX = centerX;
		const axisY = currentY + childDims.height / 2;
		const targetX = side === "right" ? childX : childX + childDims.width;
		connections.push({
			id: `${tree.id}-${child.id}`,
			d: `M ${axisX} ${axisY} H ${targetX}`,
			color: childColor,
		});

		// Step past this branch's actual tallest node — a long-content
		// descendant can be taller than the default nodeHeight and would
		// otherwise overlap the next milestone below.
		const branchMaxHeight = Math.max(childDims.height, ...subTreeNodes.map((n) => n.height));
		maxLevel1Y = currentY + branchMaxHeight;
		currentY = maxLevel1Y + yGap * 2.5;
	});

	connections.push({
		id: `${tree.id}-axis`,
		d: `M ${centerX} ${rootY + nodeHeight} V ${maxLevel1Y + 20}`,
		color: activePreset.lineColor || "#475569",
	});

	return { positioned, connections };
}
