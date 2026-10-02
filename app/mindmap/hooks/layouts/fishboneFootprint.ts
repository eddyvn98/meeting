import type { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import { getNodeDimensions } from "./layoutHelpers";

type FishboneMode = "outward" | "nested";
type FishboneDirection = -1 | 1;

interface FishboneFootprintOptions {
	connectorGutter: number;
	boneStep: number;
}

export function getFishboneDescendantColumnX(
	originX: number,
	depth: number,
	mode: FishboneMode,
	parentRight: number,
	connectorGutter: number
) {
	const step = mode === "nested" ? 188 : 206;
	return Math.max(originX + depth * step, parentRight + connectorGutter * 2);
}

function visibleChildren(node: MindmapNode) {
	return node.expanded !== false && node.children ? node.children : [];
}

/**
 * A straight single-child chain only ever occupies one column per depth level
 * and drifts away from the spine as it goes, so it never collides with a
 * neighboring category. A branching subtree (more than one child anywhere
 * along the way — e.g. a merged sub-map) keeps descendants close to its
 * entry row, so its full width is real and must be reserved.
 */
function hasBranchingDescendant(node: MindmapNode): boolean {
	const children = visibleChildren(node);
	if (children.length > 1) return true;
	return children.some(hasBranchingDescendant);
}

function descendantRightEdge(
	node: MindmapNode,
	x: number,
	originX: number,
	depth: number,
	mode: FishboneMode,
	connectorGutter: number
): number {
	const { width } = getNodeDimensions(node);
	const nodeRight = x + width;
	const childX = getFishboneDescendantColumnX(
		originX,
		depth,
		mode,
		nodeRight,
		connectorGutter
	);

	return visibleChildren(node).reduce(
		(rightEdge, child) => Math.max(
			rightEdge,
			descendantRightEdge(child, childX, originX, depth + 1, mode, connectorGutter)
		),
		nodeRight
	);
}

/**
 * Returns the rightmost edge a level-one category will occupy relative to its
 * own left edge. This is intentionally the same placement math as the renderer,
 * so adding a deep node can reserve room for the next category pair.
 */
export function getFishboneCategoryFootprint(
	category: MindmapNode,
	mode: FishboneMode,
	{ connectorGutter, boneStep }: FishboneFootprintOptions
) {
	const { width } = getNodeDimensions(category);
	const firstDescendantX = width + boneStep + 24;

	const rightEdge = visibleChildren(category).reduce(
		(edge, child) => Math.max(
			edge,
			descendantRightEdge(child, firstDescendantX, firstDescendantX, 1, mode, connectorGutter)
		),
		width
	);
	const branching = visibleChildren(category).some(hasBranchingDescendant);
	return { width: rightEdge, branching };
}

export interface FishboneCategoryFootprint {
	width: number;
	branching: boolean;
}

export function getFishboneSpinePositions(
	pairFootprints: Map<number, Partial<Record<FishboneDirection, FishboneCategoryFootprint>>>,
	spineStartX: number,
	xGap: number,
	pairSpacing: number
) {
	const spineXByPair = new Map<number, number>();
	const lastPairIndex = Math.max(-1, ...pairFootprints.keys());
	const laneFrontier: Record<FishboneDirection, number> = { "-1": spineStartX, 1: spineStartX };
	let nextSpineX = spineStartX + xGap;
	// A long single-child chain drifts away from the spine as it deepens and
	// never touches a neighboring category, so past this width it's safe to
	// stop reserving its lane and keep the backbone compact. A branching
	// subtree (more than one child anywhere along the way — e.g. a merged
	// sub-map) keeps descendants close to its entry row instead, so its full
	// width is real and must always be reserved, no matter how large.
	const maxCompactReservation = pairSpacing * 3;

	for (let pairIndex = 0; pairIndex <= lastPairIndex; pairIndex += 1) {
		const pair = pairFootprints.get(pairIndex) ?? {};
		const spineX = ([-1, 1] as const).reduce(
			(required, direction) => pair[direction] === undefined
				? required
				: Math.max(required, laneFrontier[direction] + xGap),
			nextSpineX
		);
		spineXByPair.set(pairIndex, spineX);
		([-1, 1] as const).forEach((direction) => {
			const footprint = pair[direction];
			if (!footprint) return;
			const skipReservation = !footprint.branching && footprint.width > maxCompactReservation;
			if (!skipReservation) {
				laneFrontier[direction] = Math.max(laneFrontier[direction], spineX + footprint.width);
			}
		});
		nextSpineX = spineX + pairSpacing;
	}

	return spineXByPair;
}
