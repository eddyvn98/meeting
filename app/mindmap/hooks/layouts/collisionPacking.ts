import type { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import type { PositionedNode } from "./layoutHelpers";
import { layoutRotationAngle } from "./layoutOrientation";
import { resolveMapLayout } from "./mapLayoutConfig";
import type { LayoutType } from "../usePageLayout";

type Axis = "x" | "y";

const NODE_GAP = 16;
const LOGICAL_DEPTH_GAP = 48;
const HORIZONTAL_NATIVE_LAYOUTS = new Set([
	"logical-right",
	"logical-left",
	"mindmap",
	"catalog",
	"timeline",
	"fishbone",
]);

function start(node: PositionedNode, axis: Axis) {
	return axis === "x" ? node.x : node.y - node.height / 2;
}

function size(node: PositionedNode, axis: Axis) {
	return axis === "x" ? node.width : node.height;
}

function crossStart(node: PositionedNode, axis: Axis) {
	return axis === "x" ? node.y - node.height / 2 : node.x;
}

function crossSize(node: PositionedNode, axis: Axis) {
	return axis === "x" ? node.height : node.width;
}

function crossOverlaps(a: PositionedNode, b: PositionedNode, axis: Axis) {
	const a0 = crossStart(a, axis);
	const b0 = crossStart(b, axis);
	return a0 < b0 + crossSize(b, axis) + NODE_GAP
		&& b0 < a0 + crossSize(a, axis) + NODE_GAP;
}

function nodesOverlap(a: PositionedNode, b: PositionedNode) {
	return a.x < b.x + b.width + NODE_GAP
		&& b.x < a.x + a.width + NODE_GAP
		&& a.y - a.height / 2 < b.y + b.height / 2 + NODE_GAP
		&& b.y - b.height / 2 < a.y + a.height / 2 + NODE_GAP;
}

function packOnAxis(nodes: PositionedNode[], rootId: string, axis: Axis) {
	const original = new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
	const sorted = [...nodes].sort((a, b) =>
		start(a, axis) - start(b, axis)
		|| a.level - b.level
		|| a.id.localeCompare(b.id)
	);
	const placed: PositionedNode[] = [];

	for (const node of sorted) {
		let next = start(node, axis);
		for (const other of placed) {
			if (!crossOverlaps(node, other, axis)) continue;
			next = Math.max(next, start(other, axis) + size(other, axis) + NODE_GAP);
		}
		if (axis === "x") node.x = next;
		else node.y = next + node.height / 2;
		placed.push(node);
	}

	const root = nodes.find((node) => node.id === rootId);
	const rootOriginal = original.get(rootId);
	if (root && rootOriginal) {
		const delta = axis === "x" ? rootOriginal.x - root.x : rootOriginal.y - root.y;
		for (const node of nodes) {
			if (axis === "x") node.x += delta;
			else node.y += delta;
		}
	}

	const movement = nodes.reduce((sum, node) => {
		const before = original.get(node.id)!;
		return sum + Math.abs(node.x - before.x) + Math.abs(node.y - before.y);
	}, 0);
	return { nodes, movement };
}

function cloneNodes(nodes: PositionedNode[]) {
	return nodes.map((node) => ({ ...node }));
}

function alignLogicalLevels(nodes: PositionedNode[], angle: number) {
	const depthAxis: Axis = Math.round(angle / 90) % 2 === 0 ? "x" : "y";
	const byLevel = new Map<number, PositionedNode[]>();
	for (const node of nodes) {
		if (node.node.floating) continue;
		byLevel.set(node.level, [...(byLevel.get(node.level) ?? []), node]);
	}

	for (const levelNodes of byLevel.values()) {
		if (levelNodes.length < 2) continue;
		const coordinates = levelNodes
			.map((node) => depthAxis === "x" ? node.x + node.width / 2 : node.y)
			.sort((a, b) => a - b);
		const middle = Math.floor(coordinates.length / 2);
		const aligned = coordinates.length % 2 === 0
			? (coordinates[middle - 1] + coordinates[middle]) / 2
			: coordinates[middle];
		for (const node of levelNodes) {
			if (depthAxis === "x") node.x = aligned - node.width / 2;
			else node.y = aligned;
		}
	}
}

function packLogicalLevels(nodes: PositionedNode[], rootId: string, crossAxis: Axis) {
	const root = nodes.find((node) => node.id === rootId);
	if (!root) return;
	const rootCenter = crossAxis === "x" ? root.x + root.width / 2 : root.y;
	const positionedById = new Map(nodes.map((node) => [node.id, node]));
	const byLevel = new Map<number, PositionedNode[]>();
	for (const node of nodes) {
		if (node.node.floating) continue;
		byLevel.set(node.level, [...(byLevel.get(node.level) ?? []), node]);
	}

	const shiftDescendants = (treeNode: MindmapNode, delta: number) => {
		for (const child of treeNode.children ?? []) {
			const positionedChild = positionedById.get(child.id);
			if (positionedChild && !positionedChild.node.floating) {
				if (crossAxis === "x") positionedChild.x += delta;
				else positionedChild.y += delta;
			}
			shiftDescendants(child, delta);
		}
	};

	const levels = [...byLevel.keys()].sort((a, b) => a - b);
	for (const level of levels) {
		const levelNodes = byLevel.get(level)!;
		if (levelNodes.length < 2) continue;
		const sorted = [...levelNodes].sort((a, b) =>
			start(a, crossAxis) - start(b, crossAxis) || a.id.localeCompare(b.id)
		);
		const originalStart = Math.min(...sorted.map((node) => start(node, crossAxis)));
		const originalEnd = Math.max(...sorted.map((node) => start(node, crossAxis) + size(node, crossAxis)));
		const originalById = new Map(sorted.map((node) => [
			node.id,
			crossAxis === "x" ? node.x : node.y,
		]));
		let next = originalStart;
		for (const node of sorted) {
			const packedStart = Math.max(start(node, crossAxis), next);
			if (crossAxis === "x") node.x = packedStart;
			else node.y = packedStart + node.height / 2;
			next = packedStart + size(node, crossAxis) + NODE_GAP;
		}
		const packedStart = Math.min(...sorted.map((node) => start(node, crossAxis)));
		const packedEnd = Math.max(...sorted.map((node) => start(node, crossAxis) + size(node, crossAxis)));
		const targetCenter = level === root.level + 1
			? rootCenter
			: (originalStart + originalEnd) / 2;
		const shift = targetCenter - (packedStart + packedEnd) / 2;
		for (const node of sorted) {
			if (crossAxis === "x") node.x += shift;
			else node.y += shift;
			const original = originalById.get(node.id)!;
			const current = crossAxis === "x" ? node.x : node.y;
			shiftDescendants(node.node, current - original);
		}
	}
}

function packLogicalDepth(nodes: PositionedNode[], rootId: string) {
	const root = nodes.find((node) => node.id === rootId);
	if (!root) return;
	const byLevel = new Map<number, PositionedNode[]>();
	for (const node of nodes) {
		if (node.node.floating) continue;
		byLevel.set(node.level, [...(byLevel.get(node.level) ?? []), node]);
	}
	const levels = [...byLevel.keys()].sort((a, b) => a - b);
	const firstChildren = byLevel.get(levels.find((level) => level > root.level) ?? -1);
	if (!firstChildren?.length) return;
	const direction = firstChildren.reduce((sum, node) => sum + node.y, 0)
		/ firstChildren.length >= root.y ? 1 : -1;
	let previousCenter = root.y;
	let previousHalf = root.height / 2;

	for (const level of levels.filter((candidate) => candidate > root.level)) {
		const levelNodes = byLevel.get(level)!;
		const half = Math.max(...levelNodes.map((node) => node.height / 2));
		const current = levelNodes.reduce((sum, node) => sum + node.y, 0) / levelNodes.length;
		const target = previousCenter + direction * (previousHalf + LOGICAL_DEPTH_GAP + half);
		for (const node of levelNodes) node.y += target - current;
		previousCenter = target;
		previousHalf = half;
	}
}

/**
 * Separates upright node rectangles after rotation. Both one-axis packings
 * are valid; choosing the lower-displacement result avoids layout-specific
 * branches and keeps the original visual ordering.
 */
export function packMindmapNodes(
	positioned: PositionedNode[],
	nodeToMapRoot: Map<string, MindmapNode>,
	defaultLayoutType?: string,
	_freeLayout = false,
) {
	const roots = new Map<string, MindmapNode>();
	for (const root of nodeToMapRoot.values()) roots.set(root.id, root);

	for (const root of roots.values()) {
		// Free-form maps are arranged by hand — nudging their nodes apart would be
		// the layout engine overruling the user, which is exactly what they opted
		// out of. Overlaps there are intentional until "Auto arrange" is pressed.
		if (root.style?.freeForm) continue;
		const indexes = positioned
			.map((node, index) => ({ node, index }))
			.filter(({ node }) => nodeToMapRoot.get(node.id)?.id === root.id && !node.node.floating);
		const mapNodes = indexes.map(({ node }) => node);
		const layoutType = root.style?.layoutType ?? defaultLayoutType ?? "logical-right";
		const resolved = resolveMapLayout(layoutType as LayoutType, root.style);
			if (
				resolved.family === "catalog"
				|| (resolved.family === "timeline" && resolved.isCanonical)
				|| layoutType === "swimlane"
		) {
			continue;
		}
		const angle = layoutRotationAngle(layoutType, root.style?.layoutAngle);
		const quarterTurn = Math.round(angle / 90) % 4;
		const isCardinal = Math.abs(angle - quarterTurn * 90) < 0.001;
		if (
			(layoutType === "logical-right" || layoutType === "logical-left")
			&& isCardinal
			&& quarterTurn % 2 === 1
		) {
			alignLogicalLevels(mapNodes, angle);
			packLogicalLevels(mapNodes, root.id, "x");
			packLogicalDepth(mapNodes, root.id);
			continue;
		}
		if (!mapNodes.some((a, i) => mapNodes.slice(i + 1).some((b) => nodesOverlap(a, b)))) {
			continue;
		}

		const packedX = packOnAxis(cloneNodes(mapNodes), root.id, "x");
		const packedY = packOnAxis(cloneNodes(mapNodes), root.id, "y");
		const nativeHorizontal = HORIZONTAL_NATIVE_LAYOUTS.has(layoutType);
		const packingAxis: Axis | null = !isCardinal
			? null
			: nativeHorizontal === (quarterTurn % 2 === 0) ? "y" : "x";
		const selected = packingAxis === "x"
			? packedX.nodes
			: packingAxis === "y"
				? packedY.nodes
				: packedX.movement <= packedY.movement ? packedX.nodes : packedY.nodes;
		for (let index = 0; index < indexes.length; index += 1) {
			positioned[indexes[index].index].x = selected[index].x;
			positioned[indexes[index].index].y = selected[index].y;
		}
	}
}
