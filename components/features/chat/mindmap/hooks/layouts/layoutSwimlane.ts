import { MindmapNode, StylePreset, PositionedNode, ConnectionPath } from "../../mindmap-types";
import { getDims } from "./layoutShared";

export function layoutSwimlane(
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
	const laneGap = xGap * 3;
	const rowGap = yGap * 2.5;

	const isTreeCollapsed = collapsedIds ? collapsedIds.has(tree.id) : tree.expanded === false;
	let lanes = !isTreeCollapsed && tree.children && tree.children.length > 0 ? tree.children : [];

	// Auto-unwrap: if root has exactly 1 child but that child has 2+ children,
	// the user/AI placed a swimlane "chart node" as an intermediate — promote
	// its children to be the actual lanes so the chart node becomes the title.
	if (lanes.length === 1 && (lanes[0].children?.length ?? 0) >= 2) {
		lanes = lanes[0].children!;
	}

		const laneHeaderY = 40 + nodeHeight + rowGap;
		const laneRows = lanes.map((lane) => {
			const rows: MindmapNode[] = [];
			const collectRows = (node: MindmapNode) => {
				rows.push(node);
				const isCollapsed = collapsedIds ? collapsedIds.has(node.id) : node.expanded === false;
				if (!isCollapsed) node.children?.forEach(collectRows);
			};
			collectRows(lane);
			return rows;
		});
		const maxHeightByRow: number[] = [];
		laneRows.forEach((rows) => rows.forEach((node, row) => {
			maxHeightByRow[row] = Math.max(maxHeightByRow[row] ?? 0, getDims(node, nodeWidth, nodeHeight).height);
		}));

	// One Y grid belongs to the whole diagram, not to an individual lane. A
	// taller node reserves space for its row everywhere, so equivalent process
	// steps retain an exact shared center line across lanes.
	const rowTopByIndex: number[] = [];
	let nextRowTop = laneHeaderY;
	maxHeightByRow.forEach((height, row) => {
		rowTopByIndex[row] = nextRowTop;
		nextRowTop += height + rowGap;
	});

	// A lane's reserved width must be known BEFORE any lane's centerX is
	// chosen — computing it during the positioning pass (as the previous
	// version did) centers each node on a fixed default width, so a
	// long-content node re-centers itself wider than its neighbor expected
	// and intrudes into the next lane.
	const laneMaxWidths = lanes.map((lane) => {
		let max = nodeWidth;
		const scan = (n: MindmapNode) => {
			max = Math.max(max, getDims(n, nodeWidth, nodeHeight).width);
			const isCollapsed = collapsedIds ? collapsedIds.has(n.id) : n.expanded === false;
			if (!isCollapsed && n.children) n.children.forEach(scan);
		};
		scan(lane);
		return max;
	});

	// Each child of the swimlane root owns one fixed vertical column. This mirrors
	// the reference flowchart: process nodes stay centered in their lane while
	// cross-lane connections are handled by the relationship renderer.
		const positionLaneRows = (rows: MindmapNode[], centerX: number, color: string) => {
			rows.forEach((node, row) => {
				const dims = getDims(node, nodeWidth, nodeHeight);
				positioned.push({
					node, id: node.id, topic: node.topic,
					x: centerX - dims.width / 2,
					y: rowTopByIndex[row] + maxHeightByRow[row] / 2,
					width: dims.width, height: dims.height,
					level: row, branchColor: color, direction: "right",
				});
				if (row === 0) return;
				const previous = rows[row - 1];
				connections.push({
					id: `${previous.id}-${node.id}`,
					d: `M ${centerX} ${rowTopByIndex[row - 1] + maxHeightByRow[row - 1]} V ${rowTopByIndex[row]}`,
					color,
					arrowEnd: "arrow",
				});
			});
		};

	let laneStartX = 40;
	const laneCenters: number[] = [];
	lanes.forEach((lane, index) => {
		const laneColor = activePreset.branchColors[index % activePreset.branchColors.length];
		const laneW = laneMaxWidths[index];
		const centerX = laneStartX + laneW / 2;
			positionLaneRows(laneRows[index], centerX, laneColor);
		laneCenters.push(centerX);
		laneStartX += laneW + laneGap;
	});

	// Title node anchoring the swimlane, centered above all lane headers.
	const rootDims = getDims(tree, nodeWidth, nodeHeight);
	const overallCenter = laneCenters.length > 0 ? (laneCenters[0] + laneCenters[laneCenters.length - 1]) / 2 : 40 + rootDims.width / 2;
	const rootX = overallCenter - rootDims.width / 2;
	positioned.unshift({
		node: tree, id: tree.id, topic: tree.topic,
		x: rootX, y: 40 + rootDims.height / 2,
		width: rootDims.width, height: rootDims.height,
		level: 0, branchColor: activePreset.branchColors[0], direction: "right",
	});

	laneCenters.forEach((centerX, index) => {
		connections.push({
			id: `${tree.id}-${lanes[index].id}`,
			d: `M ${overallCenter} ${40 + nodeHeight} V ${laneHeaderY - rowGap / 2} H ${centerX} V ${laneHeaderY}`,
			color: activePreset.branchColors[index % activePreset.branchColors.length],
		});
	});

	return { positioned, connections };
}
