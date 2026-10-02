import type { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";

interface FishboneSlotGeometry {
	rootWidth: number;
	xGap: number;
	pairSpacing: number;
	categoryXOffset: number;
}

const MAX_CONSECUTIVE_AUTO_SIDE_SLOTS = 3;

function inferCapturedSlot(
	root: MindmapNode,
	child: MindmapNode,
	geometry: FishboneSlotGeometry
): number | null {
	if (
		root.x === undefined || root.y === undefined
		|| child.x === undefined || child.y === undefined
	) return null;

	const firstSpineX = root.x + geometry.rootWidth + geometry.xGap;
	const capturedSpineX = child.x - geometry.categoryXOffset;
	const pairIndex = Math.round(
		(capturedSpineX - firstSpineX) / geometry.pairSpacing
	);
	if (pairIndex < 0) return null;
	return pairIndex * 2 + (child.y < root.y ? 0 : 1);
}

/**
 * Free mode captures absolute coordinates. Preserve the category slot encoded
 * by those coordinates so detaching one branch cannot re-index every branch
 * after it. Newly attached branches receive the first open fishbone slot.
 */
export function resolveFishboneSlots(
	root: MindmapNode,
	children: MindmapNode[],
	geometry: FishboneSlotGeometry,
	options: {
		useCapturedSlots?: boolean;
		weightForChild?: (child: MindmapNode) => number;
	} = {},
): Map<string, number> {
	const slots = new Map<string, number>();
	const used = new Set<number>();
	const useCapturedSlots = options.useCapturedSlots ?? true;

	if (useCapturedSlots) {
		for (const child of children) {
			const slot = inferCapturedSlot(root, child, geometry);
			if (slot === null || used.has(slot)) continue;
			slots.set(child.id, slot);
			used.add(slot);
		}
	}

	// Keep coordinates captured in free mode exactly as they were. For a new
	// structured fishbone, choose the lighter side so a dense category does not
	// force every later category into a rigid top/bottom alternation.
	if (slots.size === 0) {
		let topWeight = 0;
		let bottomWeight = 0;
		let lastSlot: number | null = null;
		let consecutiveSideSlots = 0;

		for (const child of children) {
			const preferredSide = topWeight <= bottomWeight ? 0 : 1;
			const lastSide = lastSlot === null ? null : lastSlot % 2;
			const side = lastSide === preferredSide && consecutiveSideSlots >= MAX_CONSECUTIVE_AUTO_SIDE_SLOTS
				? (preferredSide === 0 ? 1 : 0)
				: preferredSide;
			let pairIndex: number = lastSlot === null
				? 0
				: Math.floor(lastSlot / 2) + (lastSlot % 2 === side ? 1 : 0);
			let slot: number = pairIndex * 2 + side;
			while (used.has(slot)) {
				pairIndex += 1;
				slot = pairIndex * 2 + side;
			}

			slots.set(child.id, slot);
		used.add(slot);
		lastSlot = slot;
		consecutiveSideSlots = side === lastSide ? consecutiveSideSlots + 1 : 1;
			const candidateWeight = options.weightForChild?.(child) ?? 1;
			const weight = Number.isFinite(candidateWeight) ? Math.max(1, candidateWeight) : 1;
			if (side === 0) topWeight += weight;
			else bottomWeight += weight;
		}
		return slots;
	}

	let nextSlot = 0;
	for (const child of children) {
		if (slots.has(child.id)) continue;
		while (used.has(nextSlot)) nextSlot += 1;
		slots.set(child.id, nextSlot);
		used.add(nextSlot);
	}

	return slots;
}
