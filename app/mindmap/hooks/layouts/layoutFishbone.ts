"use client";

import { MindmapNode, NodeShapeType } from "@/components/features/chat/mindmap/mindmap-types";
import {
	ConnectionPath,
	getBranchColor,
	getNodeDimensions,
	PositionedNode,
	pushNode,
	X_GAP,
} from "./layoutHelpers";
import { resolveFishboneSlots } from "./fishboneSlots";
import {
	FishboneCategoryFootprint,
	getFishboneCategoryFootprint,
	getFishboneDescendantColumnX,
	getFishboneSpinePositions,
} from "./fishboneFootprint";

export { fishboneEdgePoint } from "./fishboneEdges";

type FishboneMode = "outward" | "nested";
type Direction = 1 | -1;

const ROOT_X = 80;
const PAIR_SPACING = 320;
const CATEGORY_X_OFFSET = 48;
const CATEGORY_SPINE_GAP = 72;
const TREE_VERTICAL_GAP = 18;
const SIBLING_GAP = 14;
const CONNECTOR_GUTTER = 18;
/**
 * Shortest horizontal tick from the rib into a node's left edge. Siblings share
 * one column, and a single diagonal rib crosses that column from the parent's
 * outer corner down to the last sibling, so ticks get shorter the further out a
 * sibling sits. The last one still needs this much tick to read as a wire
 * rather than as the rib simply touching the node.
 */
const RIB_MIN_TICK = 12;

function visibleChildren(node: MindmapNode): MindmapNode[] {
	return node.expanded !== false && node.children ? node.children : [];
}

function subtreeOutwardSpan(node: MindmapNode): number {
	const dims = getNodeDimensions(node);
	const children = visibleChildren(node);
	if (children.length <= 1) return dims.height;
	const childrenVerticalSpan = children.reduce(
		(sum, child) => sum + subtreeOutwardSpan(child),
		0
	) + (children.length - 1) * SIBLING_GAP;
	return Math.max(dims.height, childrenVerticalSpan);
}

function pushFishboneNode(
	positioned: PositionedNode[],
	node: MindmapNode,
	level: number,
	x: number,
	y: number,
	color: string,
	positionedById?: Map<string, PositionedNode>
) {
	const layoutShape: NodeShapeType = "rounded";
	const renderNode: MindmapNode = !node.style?.shape || node.style.shape === "rounded"
		? { ...node, style: { ...node.style, shape: layoutShape } }
		: node;
	pushNode(positioned, renderNode, level, x, y, color, positionedById);
	const result = positioned[positioned.length - 1];
	result.mapNodeShape = layoutShape;
	return result;
}

function pushDiagonalLinks(
	connections: ConnectionPath[],
	from: PositionedNode,
	children: PositionedNode[],
	direction: Direction,
	level: number
) {
	if (!children.length) return;
	const startX = from.x + from.width;
	const startY = from.y + direction * from.height / 2;
	// One rib, aimed from the parent's outer corner at the LAST sibling. Keep
	// each child path edge-to-edge as well: this is the canonical path shape
	// consumed by routing and preview parity checks.
	const nearEdgeY = (child: PositionedNode) => child.y - direction * child.height / 2;
	const last = children[children.length - 1];
	const ribEndX = Math.max(startX + RIB_MIN_TICK, last.x - RIB_MIN_TICK);
	const ribSpan = nearEdgeY(last) - startY;
	connections.push({
		id: `${from.id}-siblings-rib`,
		d: `M ${startX} ${startY} L ${ribEndX} ${nearEdgeY(last)}`,
		color: children[0].branchColor,
		lineOpacity: Math.max(58, 96 - level * 7),
	});
	children.forEach((child) => {
		const childEdgeY = nearEdgeY(child);
		const ratio = ribSpan === 0 ? 1 : (childEdgeY - startY) / ribSpan;
		const axisX = startX + (ribEndX - startX) * Math.min(1, Math.max(0, ratio));
		connections.push({
			id: `${from.id}-${child.id}`,
			d: `M ${startX} ${startY} L ${axisX} ${childEdgeY} H ${child.x}`,
			color: child.branchColor,
			lineOpacity: Math.max(58, 96 - level * 7),
		});
	});
}

function layoutDescendants(
	node: MindmapNode,
	level: number,
	nodePosition: PositionedNode,
	originX: number,
	direction: Direction,
	depth: number,
	mode: FishboneMode,
	color: string,
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	positionedById?: Map<string, PositionedNode>,
	outerGap = TREE_VERTICAL_GAP
) {
	const children = visibleChildren(node);
	if (!children.length) return;

	const ladderStartX = getFishboneDescendantColumnX(
		originX,
		depth,
		mode,
		nodePosition.x + nodePosition.width,
		CONNECTOR_GUTTER
	);
	const ladderBaseEdgeY = nodePosition.y
		+ direction * (nodePosition.height / 2 + outerGap);
	let cursorEdgeY = ladderBaseEdgeY;
	const childPositions: PositionedNode[] = [];

	children.forEach((child) => {
		const childColor = getBranchColor(child, color);
		const childDims = getNodeDimensions(child);
		const childSpan = subtreeOutwardSpan(child);
		const childX = ladderStartX;
		const childY = cursorEdgeY + direction * childDims.height / 2;
		const childPosition = pushFishboneNode(
			positioned,
			child,
			level,
			childX,
			childY,
			childColor,
			positionedById
		);
		childPositions.push(childPosition);
		cursorEdgeY += direction * (childSpan + SIBLING_GAP);
	});

	pushDiagonalLinks(connections, nodePosition, childPositions, direction, level);
	children.forEach((child, index) => {
		layoutDescendants(
			child,
			level + 1,
			childPositions[index],
			originX,
			direction,
			depth + 1,
			mode,
			childPositions[index].branchColor,
			positioned,
			connections,
			positionedById,
			TREE_VERTICAL_GAP
		);
	});
}

export function runLayoutFishbone(
	root: MindmapNode,
	activeColors: string[],
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	startY: number = 40,
	mode: FishboneMode = "outward",
	positionedById?: Map<string, PositionedNode>,
	rootX: number = ROOT_X
) {
	const children = visibleChildren(root);
	const rootDims = getNodeDimensions(root);
	const spineY = startY + 260;
	const spineStartX = rootX + rootDims.width;
	const slots = resolveFishboneSlots(root, children, {
		rootWidth: rootDims.width,
		xGap: X_GAP,
		pairSpacing: PAIR_SPACING,
		categoryXOffset: CATEGORY_X_OFFSET,
	}, {
		useCapturedSlots: !root.floating,
		weightForChild: subtreeOutwardSpan,
	});

	pushFishboneNode(positioned, root, 0, rootX, spineY, activeColors[0], positionedById);

	let spineEndX = spineStartX;
	const pairFootprints = new Map<number, Partial<Record<Direction, FishboneCategoryFootprint>>>();
	children.forEach((child, index) => {
		const slot = slots.get(child.id) ?? index;
		const pairIndex = Math.floor(slot / 2);
		const direction: Direction = slot % 2 === 0 ? -1 : 1;
		const footprint = getFishboneCategoryFootprint(child, mode, {
			connectorGutter: CONNECTOR_GUTTER,
			boneStep: mode === "nested" ? 76 : 104,
		});
		const footprints = pairFootprints.get(pairIndex) ?? {};
		footprints[direction] = footprint;
		pairFootprints.set(pairIndex, footprints);
	});
	const spineXByPair = getFishboneSpinePositions(
		pairFootprints,
		spineStartX,
		X_GAP,
		PAIR_SPACING
	);

	children.forEach((child, index) => {
		const slot = slots.get(child.id) ?? index;
		const color = getBranchColor(child, activeColors[slot % activeColors.length]);
		const childDims = getNodeDimensions(child);
		const direction: Direction = slot % 2 === 0 ? -1 : 1;
		const pairIndex = Math.floor(slot / 2);
		const spineX = spineXByPair.get(pairIndex)!;
		const childX = spineX + CATEGORY_X_OFFSET;
		const childY = spineY + direction * (CATEGORY_SPINE_GAP + childDims.height / 2);

		const childPosition = pushFishboneNode(
			positioned,
			child,
			1,
			childX,
			childY,
			color,
			positionedById
		);
		const nearEdgeY = childY - direction * childDims.height / 2;
		connections.push({
			id: `${root.id}-${child.id}-entry`,
			d: `M ${spineX} ${spineY} L ${childX} ${nearEdgeY}`,
			color,
		});

		const boneStepX = mode === "nested" ? 76 : 104;
		const descendantStep = mode === "nested" ? 188 : 206;
		const firstDescendantX = childX + childDims.width + boneStepX + 24;
		layoutDescendants(
			child,
			2,
			childPosition,
			firstDescendantX - descendantStep,
			direction,
			1,
			mode,
			color,
			positioned,
			connections,
			positionedById,
			CATEGORY_SPINE_GAP / 2
		);

		spineEndX = Math.max(spineEndX, spineX);
	});

	connections.unshift({
		id: `${root.id}-spine-backbone`,
		d: `M ${spineStartX} ${spineY} H ${spineEndX}`,
		color: activeColors[0],
		lineOpacity: 36,
	});
}
