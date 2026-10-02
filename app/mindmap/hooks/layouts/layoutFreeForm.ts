import type { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import { FLOATING_NODE_GAP } from "../nodeActions/nodeActionHelpers";
import {
	ConnectionPath,
	PositionedNode,
	getBranchColor,
	getNodeDimensions,
	pushNode,
} from "./layoutHelpers";

/**
 * A map drawn with the shape tool belongs to no layout family: the user places
 * every node by hand, so there is nothing to compute. This "engine" only reads
 * back the coordinates already stored on each node and emits one plain
 * parent→child edge per link, which `routeLayoutPaths` then routes between the
 * two boxes wherever they happen to sit.
 *
 * Keeping it a real engine branch (instead of letting a hierarchy/timeline
 * engine run and then overwriting its output with the stored coordinates) is
 * the whole point: an engine that never runs cannot leave its own scaffolding
 * — rails, spines, axis ticks — stranded at coordinates the user abandoned.
 */
export function isFreeFormMap(node: MindmapNode | null | undefined) {
	return !!node?.style?.freeForm;
}

/** Fallback for a node that has no stored position yet (pasted, imported, or
 * created before this map became free-form): stack it under its parent rather
 * than collapsing the whole subtree onto one point. */
function fallbackPosition(parent: PositionedNode, index: number, height: number) {
	return {
		x: parent.x,
		y: parent.y + parent.height / 2 + FLOATING_NODE_GAP + index * (height + FLOATING_NODE_GAP) + height / 2,
	};
}

export function runLayoutFreeForm(
	root: MindmapNode,
	activeColors: string[],
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	startY: number,
	positionedById?: Map<string, PositionedNode>,
) {
	const rootDimensions = getNodeDimensions(root);
	const rootColor = getBranchColor(root, activeColors[0]);
	const rootX = root.x ?? 0;
	const rootY = root.y ?? startY + rootDimensions.height / 2;
	pushNode(positioned, root, 0, rootX, rootY, rootColor, positionedById);

	const walk = (node: MindmapNode, parent: PositionedNode, level: number, color: string) => {
		if (node.expanded === false || !node.children?.length) return;
		node.children.forEach((child, index) => {
			const childColor = getBranchColor(child, color);
			const dimensions = getNodeDimensions(child);
			const fallback = fallbackPosition(parent, index, dimensions.height);
			pushNode(
				positioned,
				child,
				level + 1,
				child.x ?? fallback.x,
				child.y ?? fallback.y,
				childColor,
				positionedById,
			);
			if (!child.style?.noParentConnection) {
				connections.push({ id: `${node.id}-${child.id}`, d: "", color: childColor });
			}
			walk(child, positioned[positioned.length - 1], level + 1, childColor);
		});
	};
	walk(root, positioned[positioned.length - 1], 0, rootColor);
}
