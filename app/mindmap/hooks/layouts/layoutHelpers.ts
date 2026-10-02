"use client";

import { MindmapNode, NodeShapeType } from "@/components/features/chat/mindmap/mindmap-types";
import { growWidthForTopic, estimateContentHeight } from "@/components/features/chat/mindmap/mindmap-node-size";

export const NODE_WIDTH = 170;
export const NODE_HEIGHT = 36;
export const X_GAP = 65;
export const Y_GAP = 14;
export type CollapseDirection = "left" | "right" | "top" | "bottom" | "horizontal" | "vertical";

export interface PositionedNode {
	node: MindmapNode;
	id: string;
	topic: string;
	x: number;
	y: number;
	width: number;
	height: number;
	level: number;
	branchColor: string;
	mapNodeShape?: NodeShapeType;
	collapseDirection?: CollapseDirection;
}

export interface ConnectionPath {
	id: string;
	d: string;
	color: string;
	lineOpacity?: number;
	arrowEnd?: "arrow" | "dot" | "none";
	groupRotation?: { centerX: number; centerY: number; angle: number };
}

let currentDefaultShape: NodeShapeType = "rounded";

export function setDefaultShape(shape: NodeShapeType) {
	currentDefaultShape = shape;
}

// Measuring a node means estimating wrapped text, and every layout run asks for
// the same nodes many times (subtree heights, subtree widths, the layout pass
// itself), plus once more for every quick-add preview and drag projection.
// Cache by the inputs that can change the result so repeated passes are free.
const MEASURE_CACHE_LIMIT = 4000;
const measureCache = new Map<string, { width: number; height: number }>();

function measureCacheKey(node: MindmapNode): string {
	const style = node.style;
	const imageCount = node.images?.length ?? (node.image ? 1 : 0);
	// Flow (in-text) images change the height for the same image count, so their
	// placement and size belong in the key too.
	const flowKey = (node.images ?? [])
		.map((entry) => (typeof entry === "string" || !entry.flow ? "" : `${entry.flow.side}:${entry.width ?? 72}x${entry.height ?? 72}`))
		.join(",");
	return [
		node.topic, node.description ?? "", String(imageCount), flowKey,
		style?.shape ?? currentDefaultShape, style?.fontSize ?? "",
		String(style?.textPadding ?? ""),
	].join(" ");
}

export function getNodeDimensions(node: MindmapNode): { width: number; height: number } {
	if (node.width !== undefined && node.height !== undefined) {
		return { width: node.width, height: node.height };
	}

	const cacheKey = measureCacheKey(node);
	const cached = measureCache.get(cacheKey);
	if (cached) return cached;

	const measured = measureNodeDimensions(node);
	if (measureCache.size >= MEASURE_CACHE_LIMIT) measureCache.clear();
	measureCache.set(cacheKey, measured);
	return measured;
}

function measureNodeDimensions(node: MindmapNode): { width: number; height: number } {
	// An image embedded in the description (flow) is NOT in the image band, so it
	// must not reserve the band's 76px — it needs room inside the text instead.
	// Counting it in both was why a node kept a tall empty band above the text
	// after an image was dragged into a paragraph, and still overlapped the text
	// with the image itself.
	const rawImages = node.images?.length ? node.images : node.image ? [node.image] : [];
	const flowImages = rawImages.filter((entry): entry is Exclude<typeof entry, string> => typeof entry !== "string" && !!entry.flow);
	const hasImages = rawImages.length - flowImages.length > 0;
	const widestFlowImage = flowImages.reduce((widest, entry) => Math.max(widest, entry.flow?.side === "block" ? entry.width ?? 72 : 0), 0);
	// A floated image shares its vertical space with the text beside it, so it
	// only needs part of its height added; a block image owns its line outright.
	const flowImageHeight = flowImages.reduce((sum, entry) => {
		const height = entry.height ?? 72;
		const side = entry.flow?.side;
		return sum + (side === "block" ? height + 8 : side === "inline" ? height : Math.round(height * 0.6));
	}, 0);
	let width = growWidthForTopic(node.topic, NODE_WIDTH);
	if (hasImages) {
		width = Math.max(width, 180);
	}
	if (widestFlowImage > 0) {
		width = Math.max(width, widestFlowImage + 24);
	}

	const shape = node.style?.shape ?? currentDefaultShape;

	// Increase default width for narrow shapes to ensure adequate text wrapping room
	if (shape === "diamond") {
		width = Math.max(width, 260);
	} else if (shape === "hexagon") {
		width = Math.max(width, 260);
	} else if (shape === "parallelogram") {
		width = Math.max(width, 240);
	} else if (shape === "circle") {
		width = Math.max(width, 240);
	} else if (shape === "pill") {
		width = Math.max(width, 200);
	}

	// Calculate available text width according to shape inset logic in SvgNodesLayer
	let availableTextWidth = width - 12;
	if (shape === "diamond") {
		availableTextWidth = width * 0.56;
	} else if (shape === "hexagon") {
		availableTextWidth = width * 0.44;
	} else if (shape === "parallelogram") {
		availableTextWidth = width * 0.64;
	} else if (shape === "speech_bubble") {
		availableTextWidth = width - 16;
	} else if (shape === "cylinder") {
		availableTextWidth = width - 12;
	} else if (shape === "circle") {
		// Matches svgNodeHelpers: half = r*0.67, availableWidth = half*2 = min(w,h)*0.67
		availableTextWidth = width * 0.67;
	} else if (shape === "oval") {
		availableTextWidth = width * 0.73;
	} else if (shape === "cloud_rect") {
		availableTextWidth = width * 0.76;
	} else if (shape === "pill") {
		availableTextWidth = width - 40;
	}

	// Estimate lines count of topic (+ description) to adjust height — shared
	// with the chat-inline preview/card layouts so long-content sizing behaves
	// the same across every mindmap surface.
	const fontSize = node.style?.fontSize || 10.5;
	const padding = Math.max(0, node.style?.textPadding ?? 0);
	const textHeight = estimateContentHeight(node.topic, node.description, availableTextWidth, 0, fontSize, padding);

	const baseHeightNeeded = (hasImages ? 76 + textHeight : textHeight) + flowImageHeight;
	let height = baseHeightNeeded;
	const isSquareShape = shape === "circle";

	// Scale and offset final node height based on visual shape boundaries to prevent clipping
	if (shape === "diamond") {
		height = Math.max(NODE_HEIGHT, Math.ceil(baseHeightNeeded / 0.48));
	} else if (shape === "hexagon") {
		height = Math.max(NODE_HEIGHT, Math.ceil(baseHeightNeeded / 0.80));
	} else if (shape === "parallelogram") {
		height = Math.max(NODE_HEIGHT, baseHeightNeeded + 8);
	} else if (shape === "speech_bubble") {
		height = Math.max(NODE_HEIGHT, baseHeightNeeded + 18);
	} else if (shape === "cylinder") {
		height = Math.max(NODE_HEIGHT, baseHeightNeeded + 16);
	} else if (shape === "circle") {
		height = Math.max(NODE_HEIGHT, Math.ceil(baseHeightNeeded / 0.707));
	} else if (shape === "oval") {
		height = Math.max(NODE_HEIGHT, Math.ceil(baseHeightNeeded / 0.75));
	} else if (shape === "cloud_rect") {
		height = Math.max(NODE_HEIGHT, Math.ceil(baseHeightNeeded / 0.76));
	} else if (shape === "pill") {
		height = Math.max(NODE_HEIGHT, baseHeightNeeded + 12);
	} else if (!isSquareShape) {
		height = Math.max(NODE_HEIGHT, baseHeightNeeded);
	}

	// Calculate dynamic squared size for circle
	if (isSquareShape) {
		let size = 120;
		if (shape === "circle") {
			// inscribed square half-side = r*0.67, r = size/2
			// need: half*2 >= availableTextWidth (for wrap), half >= baseHeightNeeded
			// half = size/2 * 0.67 → size = max(availableTextWidth, baseHeightNeeded) / 0.67 * ... but wrap differs
			const textWidthEst = Math.min(availableTextWidth, node.topic.length * (fontSize * 0.52));
			const textDiagonal = Math.sqrt(textWidthEst * textWidthEst + baseHeightNeeded * baseHeightNeeded);
			size = Math.max(140, Math.ceil(textDiagonal / 0.67) + 16);
		}
		width = size;
		height = size;
	}

	return { width, height };
}

export function calcSubtreeHeights(n: MindmapNode, out: Record<string, number>): number {
	const { height } = getNodeDimensions(n);
	if (n.expanded === false || !n.children?.length) {
		out[n.id] = height;
		return height;
	}
	let h = n.children.reduce((s, c) => s + calcSubtreeHeights(c, out), 0) + (n.children.length - 1) * Y_GAP;
	out[n.id] = Math.max(height, h);
	return out[n.id];
}

export function calcSubtreeWidths(n: MindmapNode, out: Record<string, number>): number {
	const { width } = getNodeDimensions(n);
	if (n.expanded === false || !n.children?.length) {
		out[n.id] = width;
		return width;
	}
	let w = n.children.reduce((s, c) => s + calcSubtreeWidths(c, out), 0) + (n.children.length - 1) * X_GAP;
	out[n.id] = Math.max(width, w);
	return out[n.id];
}

export function pushNode(
	positioned: PositionedNode[],
	n: MindmapNode,
	level: number,
	x: number,
	y: number,
	color: string,
	indexMap?: Map<string, PositionedNode>
) {
	const { width, height } = getNodeDimensions(n);
	const node: PositionedNode = { node: n, id: n.id, topic: n.topic, x, y, width, height, level, branchColor: color };
	positioned.push(node);
	if (indexMap) {
		indexMap.set(node.id, node);
	}
}

export {
	bezierH,
	bezierHWithSharedTrunk,
	bezierHLeft,
	bezierV,
	bezierVWithSharedTrunk,
} from "./bezierCurves";

export function getBranchColor(node: MindmapNode, fallback: string): string {
	const c = node.style?.color;
	if (!c || c === "none" || c === node.style?.bgColor) return fallback;
	return c;
}

export function parsePathId(pathId: string, nodes: { id: string }[], nodeIds?: Set<string>): { parentId: string; childId: string } | null {
	for (const parent of nodes) {
		if (pathId.startsWith(parent.id + "-")) {
			const childId = pathId.slice(parent.id.length + 1);
			if (nodeIds ? nodeIds.has(childId) : nodes.some(n => n.id === childId)) {
				return { parentId: parent.id, childId };
			}
		}
	}
	// Only trust this naive split when both halves are real node ids. Node ids
	// are UUID-like and already contain hyphens, so a suffixed id (e.g. a
	// floating fishbone root's own "${root.id}-${child.id}-entry" connector)
	// fails the prefix match above on every candidate parent — its childId
	// includes the "-entry" tail, not a bare node id — and used to fall
	// through to here, which split on the first hyphen and returned two
	// meaningless UUID fragments as if they were real ids. Callers (like
	// parseDragPathId's own suffix-aware fallback) can't recover from a
	// truthy-but-wrong result, so return null and let them try their own
	// suffix handling instead of guessing.
	const parts = pathId.split("-");
	if (parts.length >= 2) {
		const isKnownId = (id: string) => nodeIds ? nodeIds.has(id) : nodes.some(n => n.id === id);
		if (isKnownId(parts[0]) && isKnownId(parts[1])) {
			return { parentId: parts[0], childId: parts[1] };
		}
	}
	return null;
}
