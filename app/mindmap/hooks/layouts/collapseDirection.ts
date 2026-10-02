import type { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import type { CollapseDirection, PositionedNode } from "./layoutHelpers";
import type { LayoutType } from "../usePageLayout";
import { resolveMapLayout } from "./mapLayoutConfig";

type Side = "left" | "right" | "top" | "bottom";

function sideBetween(parent: PositionedNode, child: PositionedNode): Side {
	const dx = child.x + child.width / 2 - (parent.x + parent.width / 2);
	const dy = child.y - parent.y;
	if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "left" : "right";
	return dy < 0 ? "top" : "bottom";
}

function fallbackDirection(
	positioned: PositionedNode,
	mapRoot: MindmapNode | undefined,
	mapRootPosition: PositionedNode | undefined,
	defaultLayoutType: LayoutType,
): CollapseDirection {
	const layoutType = (mapRoot?.style?.layoutType ?? defaultLayoutType) as LayoutType;
	const resolved = resolveMapLayout(layoutType, mapRoot?.style);

	if (positioned.id === mapRoot?.id && resolved.growthMode === "both-side") {
		return resolved.direction === "down" || resolved.direction === "up" ? "vertical" : "horizontal";
	}
	if (layoutType === "mindmap" && mapRootPosition) {
		return positioned.x + positioned.width / 2 < mapRootPosition.x + mapRootPosition.width / 2 ? "left" : "right";
	}
	if (layoutType === "mindmap-vertical" && mapRootPosition) {
		return positioned.y < mapRootPosition.y ? "top" : "bottom";
	}

	switch (resolved.direction) {
		case "left": return "left";
		case "up": return "top";
		case "down": return "bottom";
		case "right": return "right";
	}

	if (layoutType === "fishbone" && positioned.id === mapRoot?.id) return "vertical";
	if (layoutType === "org-chart" || layoutType === "catalog" || layoutType === "swimlane" || layoutType === "vertical-timeline") return "bottom";
	return layoutType === "flowchart" ? "right" : "right";
}

function collapseDirectionFor(
	positioned: PositionedNode,
	positionedById: Map<string, PositionedNode>,
	mapRoot: MindmapNode | undefined,
	defaultLayoutType: LayoutType,
): CollapseDirection {
	const visibleSides = new Set<Side>();
	for (const child of positioned.node.children ?? []) {
		const childPosition = positionedById.get(child.id);
		if (childPosition) visibleSides.add(sideBetween(positioned, childPosition));
	}
	if (visibleSides.has("left") && visibleSides.has("right")) return "horizontal";
	if (visibleSides.has("top") && visibleSides.has("bottom")) return "vertical";
	return [...visibleSides][0] ?? fallbackDirection(
		positioned,
		mapRoot,
		mapRoot ? positionedById.get(mapRoot.id) : undefined,
		defaultLayoutType,
	);
}

export function resolveCollapseDirections(
	positioned: PositionedNode[],
	nodeToMapRoot: Map<string, MindmapNode>,
	defaultLayoutType: LayoutType,
) {
	const positionedById = new Map(positioned.map((node) => [node.id, node]));
	for (const node of positioned) {
		if (node.node.children?.length) {
			node.collapseDirection = collapseDirectionFor(
				node,
				positionedById,
				nodeToMapRoot.get(node.id),
				defaultLayoutType,
			);
		}
	}
}
