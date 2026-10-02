"use client";

import { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import type { LayoutType } from "../usePageLayout";
import { findNodeById, findParentNode } from "@/components/features/chat/mindmap/mindmap-utils";

export type FloatingNodeDirection = "right" | "top" | "bottom" | "left";

export interface NodeGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
	floating?: boolean;
}

export const FLOATING_NODE_GAP = 80;

type FloatingNodeLike = Pick<MindmapNode, "x" | "y" | "width" | "height">;
type FloatingChildLike = FloatingNodeLike & Pick<MindmapNode, "id">;

function rectanglesOverlap(a: FloatingNodeLike, b: FloatingNodeLike) {
	const aWidth = a.width ?? 0;
	const aHeight = a.height ?? 0;
	const bWidth = b.width ?? 0;
	const bHeight = b.height ?? 0;
	if (a.x === undefined || a.y === undefined || b.x === undefined || b.y === undefined) return false;
	return Math.abs(a.x - b.x) * 2 < aWidth + bWidth
		&& Math.abs(a.y - b.y) * 2 < aHeight + bHeight;
}

export function getFloatingNodePosition(
	target: NodeGeometry,
	direction: FloatingNodeDirection,
	existingNodes: FloatingNodeLike[] = [],
) {
	const width = target.width;
	const height = target.height;
	const horizontal = direction === "left" || direction === "right";
	const step = (horizontal ? height : width) + FLOATING_NODE_GAP;
	const base = { x: target.x, y: target.y };
	if (direction === "right") base.x += target.width + FLOATING_NODE_GAP;
	if (direction === "left") base.x -= width + FLOATING_NODE_GAP;
	if (direction === "top") base.y -= target.height / 2 + height / 2 + FLOATING_NODE_GAP;
	if (direction === "bottom") base.y += target.height / 2 + height / 2 + FLOATING_NODE_GAP;

	const candidates = existingNodes.filter((node) => node.x !== undefined && node.y !== undefined);
	for (let index = 0; index <= candidates.length + 8; index += 1) {
		const distance = index === 0 ? 0 : Math.ceil(index / 2) * step;
		const sign = index > 0 && index % 2 === 0 ? -1 : 1;
		const position = {
			x: horizontal ? base.x : base.x + distance * sign,
			y: horizontal ? base.y + distance * sign : base.y,
			width,
			height,
		};
		if (!candidates.some((node) => rectanglesOverlap(position, node))) return position;
	}

	return { ...base, width, height };
}

function isFloatingChildOnSide(node: FloatingChildLike, target: NodeGeometry, direction: FloatingNodeDirection) {
	if (node.x === undefined || node.y === undefined) return false;
	const width = node.width ?? target.width;
	const height = node.height ?? target.height;
	const clearance = FLOATING_NODE_GAP / 2;
	if (direction === "right") return node.x >= target.x + target.width + clearance;
	if (direction === "left") return node.x + width <= target.x - clearance;
	if (direction === "top") return node.y + height / 2 <= target.y - target.height / 2 - clearance;
	return node.y - height / 2 >= target.y + target.height / 2 + clearance;
}

export function getFloatingChildPositions(
	target: NodeGeometry,
	direction: FloatingNodeDirection,
	existingNodes: FloatingChildLike[],
	newNodeId: string,
	outsideNodes: FloatingChildLike[] = [],
) {
	const horizontal = direction === "left" || direction === "right";
	const members = existingNodes.filter((node) => node.id === newNodeId || isFloatingChildOnSide(node, target, direction));
	if (!members.length) return new Map<string, { x: number; y: number }>();
	const ordered = [...members].sort((a, b) => {
		if (a.id === newNodeId) return 1;
		if (b.id === newNodeId) return -1;
		const aCross = horizontal ? a.y ?? target.y : a.x ?? target.x;
		const bCross = horizontal ? b.y ?? target.y : b.x ?? target.x;
		return aCross - bCross || a.id.localeCompare(b.id);
	});
	const sizes = ordered.map((node) => horizontal ? node.height ?? target.height : node.width ?? target.width);
	const total = sizes.reduce((sum, size) => sum + size, 0) + FLOATING_NODE_GAP * (ordered.length - 1);
	let cursor = horizontal ? target.y - total / 2 : target.x + target.width / 2 - total / 2;
	const positions = new Map<string, { x: number; y: number }>();
	const dims = new Map<string, { width: number; height: number }>();
	ordered.forEach((node, index) => {
		const width = node.width ?? target.width;
		const height = node.height ?? target.height;
		dims.set(node.id, { width, height });
		positions.set(node.id, {
			x: horizontal
				? direction === "right" ? target.x + target.width + FLOATING_NODE_GAP : target.x - width - FLOATING_NODE_GAP
				: cursor,
			y: horizontal
				? cursor + height / 2
				: direction === "top"
					? target.y - target.height / 2 - height / 2 - FLOATING_NODE_GAP
					: target.y + target.height / 2 + height / 2 + FLOATING_NODE_GAP,
		});
		cursor += (horizontal ? height : width) + (index < ordered.length - 1 ? FLOATING_NODE_GAP : 0);
	});
	// The stacking above only keeps THIS parent's own floating children apart
	// from each other — it has no idea a cousin branch's floating node already
	// sits at that exact spot. Nudge the whole stack sideways along the CROSS
	// axis (keeping the internal order/spacing just computed) until none of
	// its members land on an unrelated floating node elsewhere on the canvas.
	// This mirrors getFloatingNodePosition's own search direction below: pushing
	// further out along the growth axis instead would keep the same distance
	// sideways but move the group past whatever else sits directly beyond it,
	// forcing the connector to snake around every node in between to reach a
	// spot that's no longer "just below/right of" its parent.
	//
	// A sibling of the same anchor on a DIFFERENT side (e.g. already has a
	// child below while we're placing one to the right) is neither a `member`
	// here nor part of the caller's `outsideNodes` (callers exclude the whole
	// anchor's children set, since same-side members are handled above) — so
	// without this it's invisible to the collision check entirely. Fold it in
	// as an obstacle.
	const offSideSiblings = existingNodes.filter((node) => !members.includes(node));
	const obstacles = outsideNodes.length || offSideSiblings.length ? [...outsideNodes, ...offSideSiblings] : outsideNodes;
	if (obstacles.length) {
		const crossStep = (horizontal
			? Math.max(...ordered.map((node) => dims.get(node.id)!.height))
			: Math.max(...ordered.map((node) => dims.get(node.id)!.width))
		) + FLOATING_NODE_GAP;
		const rectsAt = (offset: number) => ordered.map((node) => {
			const base = positions.get(node.id)!;
			const { width, height } = dims.get(node.id)!;
			return {
				x: horizontal ? base.x : base.x + offset,
				y: horizontal ? base.y + offset : base.y,
				width,
				height,
			};
		});
		let nudge = 0;
		const maxAttempts = obstacles.length + 8;
		for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
			const distance = attempt === 0 ? 0 : Math.ceil(attempt / 2) * crossStep;
			const sign = attempt > 0 && attempt % 2 === 0 ? -1 : 1;
			const offset = distance * sign;
			const rects = rectsAt(offset);
			if (!rects.some((rect) => obstacles.some((obstacle) => rectanglesOverlap(rect, obstacle)))) {
				nudge = offset;
				break;
			}
		}
		if (nudge !== 0) {
			ordered.forEach((node) => {
				const base = positions.get(node.id)!;
				positions.set(node.id, {
					x: horizontal ? base.x : base.x + nudge,
					y: horizontal ? base.y + nudge : base.y,
				});
			});
		}
	}
	return positions;
}

/** Every floating node anywhere in the document, regardless of which parent
 * it's nested under — used to keep a newly placed floating node from landing
 * on top of an unrelated branch's node, which per-parent sibling checks can
 * never see. */
export function collectFloatingNodes(root: MindmapNode, excludeIds: ReadonlySet<string> = new Set()): FloatingChildLike[] {
	const result: FloatingChildLike[] = [];
	const visit = (node: MindmapNode) => {
		if (node.floating && !excludeIds.has(node.id)) {
			result.push({ id: node.id, x: node.x ?? 0, y: node.y ?? 0, width: node.width ?? 0, height: node.height ?? 0 });
		}
		node.children?.forEach(visit);
	};
	visit(root);
	return result;
}

export function reflowFloatingChildren(
	root: MindmapNode,
	parentId: string,
	target: NodeGeometry,
	direction: FloatingNodeDirection,
	newNodeId: string,
	outsideNodes: FloatingChildLike[] = [],
): MindmapNode {
	if (root.id === parentId) {
		const newNode = root.children.find((child) => child.id === newNodeId);
		if (!newNode?.floating) return root;
		const positions = getFloatingChildPositions(target, direction, root.children, newNodeId, outsideNodes);
		return {
			...root,
			children: root.children.map((child) => {
				const position = positions.get(child.id);
				return position ? { ...child, ...position } : child;
			}),
		};
	}
	return { ...root, children: root.children.map((child) => reflowFloatingChildren(child, parentId, target, direction, newNodeId, outsideNodes)) };
}

export function positionFloatingChild(
	root: MindmapNode,
	childId: string,
	parent: NodeGeometry,
	direction: FloatingNodeDirection = "right"
): MindmapNode {
	const nextPosition = { x: parent.x, y: parent.y };
	if (direction === "right") nextPosition.x += parent.width + FLOATING_NODE_GAP;
	if (direction === "left") nextPosition.x -= parent.width + FLOATING_NODE_GAP;
	if (direction === "top" || direction === "bottom") {
		nextPosition.y += (direction === "top" ? -1 : 1) * (parent.height + FLOATING_NODE_GAP);
	}
	if (root.id === childId) return { ...root, ...nextPosition, floating: true };
	return { ...root, children: root.children.map((child) => positionFloatingChild(child, childId, parent, direction)) };
}

export function createParentNode(
	id: string,
	target: NodeGeometry | null | undefined,
	source: MindmapNode | null | undefined,
	layoutType?: LayoutType
): MindmapNode {
	const parent = withStyleFrom({
		id,
		topic: "Merged Topic",
		children: [],
		width: target?.width ?? source?.width,
		height: target?.height ?? source?.height,
	}, source, layoutType);
	return target?.floating
		? { ...parent, floating: true, x: target.x, y: target.y }
		: parent;
}

export function createFloatingNode(
	id: string,
	target: NodeGeometry,
	direction: FloatingNodeDirection,
	isFishbone: boolean,
	existingNodes: FloatingNodeLike[] = [],
): MindmapNode {
	if (isFishbone) {
		return { id, topic: "New Node", children: [], expanded: true, width: target.width, height: target.height };
	}
	// A child added from a drawn floating shape is a visual continuation of that
	// shape. Reuse its box instead of the generic mind-map dimensions so the
	// new node stays aligned on the requested axis.
	const width = target.width;
	const height = target.height;
	const position = getFloatingNodePosition(target, direction, existingNodes);

	return { id, topic: "New Node", children: [], expanded: true, floating: true, ...position };
}

export function isFishboneMap(tree: MindmapNode, nodeId: string, fishboneMapRootIds?: ReadonlySet<string>, fallbackLayout?: LayoutType) {
	const mapRoot = tree.id === "virtual-root"
		? tree.children.find((candidate) => findNodeById(candidate, nodeId))
		: tree;
	return !!mapRoot && (fishboneMapRootIds?.has(mapRoot.id) || mapRoot.style?.layoutType === "fishbone" || fallbackLayout === "fishbone");
}

// New nodes should visually match the node they were created from (same shape,
// colors, typography, etc.) instead of resetting to the default style. In
// flowchart layout, connector lines are directional by convention, so newly
// created nodes default to an arrow-ended line unless the source already set one.
// Floating "draw shape" chains follow the same convention regardless of the
// map's own layoutType — they read as a flowchart on the canvas (see the
// Lark-whiteboard reference the user pointed at), so a new floating node
// defaults to an orthogonal, arrow-ended connector unless the chain already
// carries its own line style.
export function withStyleFrom(node: MindmapNode, source: MindmapNode | null | undefined, layoutType?: LayoutType): MindmapNode {
	const baseStyle = source?.style ? { ...source.style } : undefined;
	if (node.floating) {
		return {
			...node,
			style: {
				...baseStyle,
				lineType: baseStyle?.lineType ?? "orthogonal",
				arrowEnd: baseStyle?.arrowEnd ?? "arrow",
			},
		};
	}
	if ((layoutType === "flowchart" || layoutType === "swimlane") && baseStyle?.arrowEnd === undefined) {
		return { ...node, style: { ...baseStyle, arrowEnd: "arrow" } };
	}
	if (!baseStyle) return node;
	return { ...node, style: baseStyle };
}

export function collectDescendantIds(node: MindmapNode | null | undefined, ids: Set<string>) {
	if (!node) return;
	ids.add(node.id);
	node.children.forEach((child) => collectDescendantIds(child, ids));
}

// A multi-selection can include both a branch and its own descendants (e.g. a
// marquee that boxes a whole subtree). Copy/Cut must only take the outermost
// selected nodes — cloning a descendant separately would duplicate it once as
// part of its selected ancestor and once on its own.
export function collectTopLevelSelectedNodes(tree: MindmapNode, selectedIds: ReadonlySet<string>): MindmapNode[] {
	const result: MindmapNode[] = [];
	const visit = (node: MindmapNode, ancestorSelected: boolean) => {
		const isSelected = selectedIds.has(node.id);
		if (isSelected && !ancestorSelected) result.push(node);
		node.children.forEach((child) => visit(child, ancestorSelected || isSelected));
	};
	visit(tree, false);
	return result;
}

export function pruneRelationships(node: MindmapNode, deletedIds: Set<string>): MindmapNode {
	const nextNode: MindmapNode = { ...node };
	if (node.relationships) {
		nextNode.relationships = node.relationships.filter((rel) => !deletedIds.has(rel.from) && !deletedIds.has(rel.to));
	}
	if (node.children) {
		nextNode.children = node.children.map((child) => pruneRelationships(child, deletedIds));
	}
	return nextNode;
}

export function findSwimlaneContaining(root: MindmapNode, nodeId: string): MindmapNode | null {
	if (root.style?.layoutType === "swimlane" && findNodeById(root, nodeId)) return root;
	for (const child of root.children ?? []) {
		const found = findSwimlaneContaining(child, nodeId);
		if (found) return found;
	}
	return null;
}

export function removeNodesByIds(node: MindmapNode, deletedIds: Set<string>): MindmapNode | null {
	if (deletedIds.has(node.id)) return null;
	return {
		...node,
		children: node.children
			.map((child) => removeNodesByIds(child, deletedIds))
			.filter((child): child is MindmapNode => child !== null),
	};
}

export function getSelectedNodeIdsFromDom(fallbackId: string): string[] {
	if (typeof document === "undefined") {
		return fallbackId ? [fallbackId] : [];
	}

	const ids = new Set<string>();
	document.querySelectorAll<SVGGElement>(".mindmap-node-svg").forEach((group) => {
		const nodeId = group.getAttribute("data-node-id");
		if (!nodeId) return;
		const selectedMarker = group.querySelector(".node-resize-handles.opacity-100, .quick-add-buttons.opacity-100");
		if (selectedMarker) ids.add(nodeId);
	});

	if (ids.size > 0) return Array.from(ids);
	return fallbackId ? [fallbackId] : [];
}

export function findNearestSurvivingAncestor(tree: MindmapNode, nodeId: string, deletedIds: Set<string>): string | null {
	let currentId: string | null = nodeId;
	while (currentId) {
		const parent = findParentNode(tree, currentId);
		if (!parent) return null;
		if (!deletedIds.has(parent.id)) return parent.id;
		currentId = parent.id;
	}
	return null;
}
