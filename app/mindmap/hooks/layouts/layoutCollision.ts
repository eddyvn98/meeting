import type { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import { placeRectAvoidingOverlap, rectFromPlacement, rectsOverlap } from "@/app/mindmap/utils/canvas-geometry";
import type { PositionedNode } from "./layoutHelpers";

function nodeRect(node: PositionedNode) {
	return rectFromPlacement({ x: node.x, y: node.y - node.height / 2, width: node.width, height: node.height });
}

function unionRect(nodes: PositionedNode[]) {
	const rects = nodes.map(nodeRect);
	return {
		left: Math.min(...rects.map((rect) => rect.left)),
		right: Math.max(...rects.map((rect) => rect.right)),
		top: Math.min(...rects.map((rect) => rect.top)),
		bottom: Math.max(...rects.map((rect) => rect.bottom)),
	};
}

/** Keeps explicit/floating node groups from landing on auto-laid-out nodes.
 * Free-form maps intentionally bypass this pass because their positions are
 * user-authored. */
export function avoidFloatingNodeOverlaps(positioned: PositionedNode[], tree: MindmapNode, freeLayout: boolean) {
	if (freeLayout || tree.style?.freeForm) return;
	const nodeById = new Map<string, MindmapNode>();
	const parentById = new Map<string, MindmapNode>();
	const visit = (node: MindmapNode, parent?: MindmapNode) => {
		nodeById.set(node.id, node);
		if (parent) parentById.set(node.id, parent);
		(node.children || []).forEach((child) => visit(child, node));
	};
	visit(tree);

	const positionedById = new Map(positioned.map((node) => [node.id, node]));
	const groupRoots = positioned.filter((node) => node.node.floating && !parentById.get(node.id)?.floating);
	for (const root of groupRoots) {
		// Draw Shape nodes are user-authored coordinates. They are often siblings
		// of an ordinary map root under `virtual-root`, so checking only
		// `tree.style.freeForm` misses them and a later drag/relayout can move the
		// whole shape chain to avoid an unrelated node.
		if (root.node.style?.freeForm) continue;
		const ids = new Set<string>();
		const collect = (node: MindmapNode) => {
			ids.add(node.id);
			(node.children || []).forEach(collect);
		};
		const source = nodeById.get(root.id);
		if (!source) continue;
		collect(source);
		const group = [...ids].map((id) => positionedById.get(id)).filter((node): node is PositionedNode => !!node);
		if (group.length === 0) continue;
		const groupRect = unionRect(group);
		const occupied = positioned.filter((node) => !ids.has(node.id)).map(nodeRect);
		if (!occupied.some((rect) => rectsOverlap(groupRect, rect))) continue;
		const width = groupRect.right - groupRect.left;
		const height = groupRect.bottom - groupRect.top;
		const next = placeRectAvoidingOverlap({ x: groupRect.left, y: groupRect.top, width, height }, occupied, 32);
		const dx = next.x - groupRect.left;
		const dy = next.y - groupRect.top;
		for (const node of group) {
			node.x += dx;
			node.y += dy;
		}
	}
}
