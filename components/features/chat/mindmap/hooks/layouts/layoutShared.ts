import { MindmapNode } from "../../mindmap-types";
import { growWidthForTopic, estimateContentHeight } from "../../mindmap-node-size";

// A node's real content-driven box size, based on `baseWidth`/`baseHeight`
// (the card/preview's configured default) instead of assuming every node is
// exactly that size — a long topic or description otherwise overlaps
// neighboring nodes/branches instead of growing its own box.
export function getDims(node: MindmapNode, baseWidth: number, baseHeight: number): { width: number; height: number } {
	const width = growWidthForTopic(node.topic, baseWidth);
	const availableTextWidth = width - 12;
	const height = estimateContentHeight(node.topic, node.description, availableTextWidth, baseHeight);
	return { width, height };
}
