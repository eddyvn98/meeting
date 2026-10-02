import type { MindmapNode, NodeStyle } from "@/components/features/chat/mindmap/mindmap-types";
import { normalizeTableNode } from "@/app/mindmap/table/compat/legacy-table-adapter";
import type { LayoutType } from "../usePageLayout";
import { resolvedLayoutDirection } from "./layoutOrientation";

export type MapLayoutDirection = "right" | "left" | "down" | "up";
export type MapLayoutFamily =
	| "hierarchy"
	| "catalog"
	| "timeline"
	| "fishbone"
	| "flowchart"
	| "swimlane";

export interface ResolvedMapLayout {
	family: MapLayoutFamily;
	direction?: MapLayoutDirection;
	growthMode?: MapHierarchyGrowthMode;
	engineLayoutType: LayoutType;
	isCanonical: boolean;
}

export type MapHierarchyGrowthMode = "one-side" | "both-side";

const ANGLE_TO_DIRECTION: Record<number, MapLayoutDirection> = {
	0: "right",
	90: "down",
	180: "left",
	270: "up",
};

const FAMILY_BY_LAYOUT: Record<LayoutType, MapLayoutFamily> = {
	"logical-right": "hierarchy",
	"logical-left": "hierarchy",
	mindmap: "hierarchy",
	"mindmap-vertical": "hierarchy",
	"org-chart": "hierarchy",
	catalog: "catalog",
	timeline: "timeline",
	"vertical-timeline": "timeline",
	fishbone: "fishbone",
	flowchart: "flowchart",
	swimlane: "swimlane",
};

export function mapLayoutFamily(layoutType: LayoutType): MapLayoutFamily {
	return FAMILY_BY_LAYOUT[layoutType];
}

export function supportsMapDirection(family: MapLayoutFamily) {
	return family === "hierarchy" || family === "timeline" || family === "catalog";
}

export function supportsMapLineStyle(family: MapLayoutFamily) {
	return family === "hierarchy" || family === "flowchart" || family === "swimlane";
}

export function defaultMapDirection(family: MapLayoutFamily): MapLayoutDirection | undefined {
	return supportsMapDirection(family) ? "right" : undefined;
}

function legacyDirection(layoutType: LayoutType, layoutAngle?: number): MapLayoutDirection | undefined {
	const family = mapLayoutFamily(layoutType);
	if (family !== "hierarchy" && family !== "timeline") return undefined;
	const angle = resolvedLayoutDirection(layoutType, layoutAngle);
	return ANGLE_TO_DIRECTION[angle] ?? ANGLE_TO_DIRECTION[Math.round(angle / 90) * 90 % 360];
}

export function hierarchyGrowthModeFor(
	layoutType: LayoutType,
	style?: Pick<NodeStyle, "layoutGrowthMode">,
): MapHierarchyGrowthMode {
	return style?.layoutGrowthMode ?? (layoutType === "mindmap" || layoutType === "mindmap-vertical" ? "both-side" : "one-side");
}

export function engineLayoutFor(
	family: MapLayoutFamily,
	direction?: MapLayoutDirection,
	growthMode: MapHierarchyGrowthMode = "one-side",
): LayoutType {
	if (family === "hierarchy") {
		if (growthMode === "both-side") return direction === "down" || direction === "up" ? "mindmap-vertical" : "mindmap";
		if (direction === "left") return "logical-left";
		if (direction === "down" || direction === "up") return "org-chart";
		return "logical-right";
	}
	if (family === "timeline") {
		return direction === "down" || direction === "up" ? "vertical-timeline" : "timeline";
	}
	return family;
}

export function resolveMapLayout(
	layoutType: LayoutType,
	style?: Pick<NodeStyle, "layoutAngle" | "layoutDirection" | "layoutGrowthMode">,
): ResolvedMapLayout {
	const family = mapLayoutFamily(layoutType);
	const canonicalDirection = style?.layoutDirection;
	const direction = supportsMapDirection(family)
		? canonicalDirection ?? legacyDirection(layoutType, style?.layoutAngle)
		: undefined;
	const growthMode = family === "hierarchy" ? hierarchyGrowthModeFor(layoutType, style) : undefined;
	return {
		family,
		direction,
		growthMode,
		engineLayoutType: canonicalDirection
			? engineLayoutFor(family, canonicalDirection, growthMode)
			: layoutType,
		isCanonical: canonicalDirection !== undefined,
	};
}

export function canonicalLayoutStyle(
	family: MapLayoutFamily,
	direction?: MapLayoutDirection,
	growthMode: MapHierarchyGrowthMode = "one-side",
): Pick<NodeStyle, "layoutType" | "layoutDirection" | "layoutAngle" | "layoutGrowthMode"> {
	const selectedDirection = supportsMapDirection(family)
		? direction ?? defaultMapDirection(family)
		: undefined;
	return {
		layoutType: engineLayoutFor(family, selectedDirection, growthMode),
		layoutDirection: selectedDirection,
		layoutAngle: undefined,
		...(family === "hierarchy" ? { layoutGrowthMode: growthMode } : {}),
	};
}

// The multi-map container is a client-only sentinel keyed by its id. Persisted
// (and realtime-synced) trees carry a real uuid there, and every consumer that
// checks `id === "virtual-root"` then treats the container as a drawable node:
// the map root drops to level 1 and each branch cascades one level deeper —
// harmless-looking in horizontal layouts, a diagonal staircase in vertical ones.
// Both reserved empty-canvas titles can identify the persisted wrapper because
// older records used "Virtual Root" while new blank maps use "New Mindmap".
// Returns the same object when nothing needs fixing — callers feed remote
// projections through this on every sync tick, and a fresh object each time
// would look like a local edit and loop back out as another diff.
export function normalizeVirtualRootId(node: MindmapNode): MindmapNode {
	const isPersistedVirtualRoot = node.topic === "Virtual Root" || node.topic === "New Mindmap";
	return isPersistedVirtualRoot && node.id !== "virtual-root"
		? { ...node, id: "virtual-root" }
		: node;
}

export function normalizeLegacyMapLayout(node: MindmapNode): MindmapNode {
	const normalizedChildren = node.children.map(normalizeLegacyMapLayout);
	const childrenChanged = normalizedChildren.some((child, index) => child !== node.children[index]);
	const ensureTableV2 = (candidate: MindmapNode) => candidate.table
		? normalizeTableNode(candidate)
		: candidate;
	const style = node.style ?? {};
	const legacyGrowthMode = style?.layoutType === "mindmap" || style?.layoutType === "mindmap-vertical";
	if (!legacyGrowthMode || style.layoutGrowthMode) {
		return ensureTableV2(normalizeVirtualRootId(node.style && !childrenChanged ? node : { ...node, children: normalizedChildren, style }));
	}
	const direction = style.layoutType === "mindmap-vertical" ? "down" : "right";
	return ensureTableV2(normalizeVirtualRootId({
		...node,
		children: normalizedChildren,
		style: { ...style, ...canonicalLayoutStyle("hierarchy", style.layoutDirection ?? direction, "both-side") },
	}));
}

export function directionToAngle(direction?: MapLayoutDirection) {
	if (direction === "down") return 90;
	if (direction === "left") return 180;
	if (direction === "up") return -90;
	return 0;
}

export function angleToCardinalDirection(angle: number): MapLayoutDirection | null {
	const normalized = ((angle % 360) + 360) % 360;
	return ANGLE_TO_DIRECTION[normalized] ?? null;
}
