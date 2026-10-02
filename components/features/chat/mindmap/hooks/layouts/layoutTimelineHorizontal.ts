import { MindmapNode, StylePreset, PositionedNode, ConnectionPath } from "../../mindmap-types";
import { getDims } from "./layoutShared";

export function layoutTimeline(
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

	const centerY = 300;
	const rootX = 40;
	const rootY = centerY;
	const rootDims = getDims(tree, nodeWidth, nodeHeight);

	positioned.push({
		node: tree,
		id: tree.id,
		topic: tree.topic,
		x: rootX,
		y: rootY,
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

	let currentX = rootX + rootDims.width + xGap * 1.5;
	let maxLevel1X = currentX;

	tree.children.forEach((child, index) => {
		const childColor = activePreset.branchColors[index % activePreset.branchColors.length];
		const childDims = getDims(child, nodeWidth, nodeHeight);

		let side: "top" | "bottom" = "top";
		if (subOption === 1) {
			side = index % 2 === 0 ? "top" : "bottom";
		} else if (subOption === 2) {
			side = "top";
		} else {
			side = "bottom";
		}

		const level1Y =
			side === "top"
				? centerY - childDims.height * 1.5 - yGap * 2
				: centerY + childDims.height * 1.5 + yGap * 2;

		const subTreeNodes: PositionedNode[] = [];
		const subTreeConnections: ConnectionPath[] = [];

		const traverseDescendants = (
			node: MindmapNode,
			level: number,
			x: number,
			startY: number,
			direction: "up" | "down",
			color: string
		) => {
			const dims = getDims(node, nodeWidth, nodeHeight);
			const nodeY = startY;
			subTreeNodes.push({
				node,
				id: node.id,
				topic: node.topic,
				x,
				y: nodeY,
				width: dims.width,
				height: dims.height,
				level,
				branchColor: color,
				direction: "right",
			});

			const childIsCollapsed = collapsedIds ? collapsedIds.has(node.id) : node.expanded === false;
			if (!childIsCollapsed && node.children && node.children.length > 0) {
				// Edge of this node the chain continues from (its far side in the
				// stacking direction) — the next descendant's own height, not a
				// fixed nodeHeight, determines how far away its center must sit.
				let cursorEdge = direction === "up" ? nodeY - dims.height / 2 : nodeY + dims.height / 2;

				node.children.forEach((c) => {
					const cDims = getDims(c, nodeWidth, nodeHeight);
					const nextY = direction === "up"
						? cursorEdge - yGap - cDims.height / 2
						: cursorEdge + yGap + cDims.height / 2;

					traverseDescendants(c, level + 1, x, nextY, direction, color);

					const sX = x + dims.width / 2;
					const sY = direction === "up" ? nodeY - dims.height / 2 : nodeY + dims.height / 2;
					const eX = x + cDims.width / 2;
					const eY = direction === "up" ? nextY + cDims.height / 2 : nextY - cDims.height / 2;
					subTreeConnections.push({
						id: `${node.id}-${c.id}`,
						d: `M ${sX} ${sY} V ${eY} H ${eX}`,
						color,
					});

					cursorEdge = direction === "up" ? nextY - cDims.height / 2 : nextY + cDims.height / 2;
				});
			}
		};

		traverseDescendants(child, 1, currentX, level1Y, side === "top" ? "up" : "down", childColor);

		positioned.push(...subTreeNodes);
		connections.push(...subTreeConnections);

		const axisX = currentX + childDims.width / 2;
		const axisY = centerY;
		const targetY = side === "top" ? level1Y + childDims.height / 2 : level1Y - childDims.height / 2;
		connections.push({
			id: `${tree.id}-${child.id}`,
			d: `M ${axisX} ${axisY} V ${targetY}`,
			color: childColor,
		});

		// Step past this branch's actual widest node — a long-content node
		// anywhere in the chain (not just the level-1 child) can be wider than
		// the default nodeWidth and would otherwise overlap the next branch.
		const branchMaxWidth = Math.max(childDims.width, ...subTreeNodes.map((n) => n.width));
		maxLevel1X = currentX + branchMaxWidth;
		currentX = maxLevel1X + xGap * 1.5;
	});

	connections.push({
		id: `${tree.id}-axis`,
		d: `M ${rootX + nodeWidth} ${centerY} H ${maxLevel1X + 20}`,
		color: activePreset.lineColor || "#475569",
	});

	return { positioned, connections };
}
