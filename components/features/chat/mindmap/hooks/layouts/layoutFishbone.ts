import { runLayoutFishbone } from "@/app/mindmap/hooks/layouts/layoutFishbone";
import type {
	ConnectionPath as CanvasConnectionPath,
	PositionedNode as CanvasPositionedNode,
} from "@/app/mindmap/hooks/layouts/layoutHelpers";
import type { ConnectionPath, MindmapNode, PositionedNode, StylePreset } from "../../mindmap-types";
import { getDims } from "./layoutShared";

function createPreviewTree(
	node: MindmapNode,
	nodeWidth: number,
	nodeHeight: number,
	collapsedIds?: Set<string>,
): MindmapNode {
	const dimensions = getDims(node, nodeWidth, nodeHeight);
	return {
		...node,
		width: dimensions.width,
		height: dimensions.height,
		expanded: collapsedIds?.has(node.id) ? false : node.expanded,
		children: node.children.map((child) => createPreviewTree(child, nodeWidth, nodeHeight, collapsedIds)),
	};
}

/**
 * Preview and /mindmap intentionally share the canvas fishbone engine. The
 * preview adapter supplies its measured dimensions and collapsed-node state;
 * it does not maintain an independent geometry algorithm.
 */
export function layoutFishbone(
	tree: MindmapNode,
	activePreset: StylePreset,
	_subOption: number,
	nodeWidth: number,
	nodeHeight: number,
	_xGap: number,
	_yGap: number,
	collapsedIds?: Set<string>,
): { positioned: PositionedNode[]; connections: ConnectionPath[] } {
	const positioned: CanvasPositionedNode[] = [];
	const connections: CanvasConnectionPath[] = [];
	const previewTree = createPreviewTree(tree, nodeWidth, nodeHeight, collapsedIds);

	runLayoutFishbone(previewTree, activePreset.branchColors, positioned, connections, 40, "nested", undefined, 40);

	return {
		positioned,
		connections,
	};
}
