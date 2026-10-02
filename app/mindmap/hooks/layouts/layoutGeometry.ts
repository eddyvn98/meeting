import type { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import { isFreeFormMap } from "./layoutFreeForm";
import { packMindmapNodes } from "./collisionPacking";
import {
	anchorPoint,
	findBestOrthogonalRoute,
	routeToPath,
} from "./obstacleRouter";
import { bezierH, bezierHWithSharedTrunk, bezierV, bezierVWithSharedTrunk, parsePathId, type ConnectionPath, type PositionedNode } from "./layoutHelpers";
import { resolveMapLayout } from "./mapLayoutConfig";
import { hierarchySides } from "./hierarchyRouting";
import type { LayoutType } from "../usePageLayout";

// Shared-trunk bundling assumes the child's anchor sits further along the
// anchor axis than the parent's (e.g. a bottom anchor's trunk runs downward).
// An imbalanced subtree can place a deeper child's anchor on the *other*
// side of that axis — the trunk would then double back through the parent's
// own body instead of leading away from it. Bundling must not be applied to
// that edge; the caller falls back to the collision-safe routed path.
function trunkDirectionIsSane(
	fromSide: "top" | "bottom" | "left" | "right",
	start: { x: number; y: number },
	end: { x: number; y: number },
): boolean {
	switch (fromSide) {
		case "right": return end.x >= start.x;
		case "left": return end.x <= start.x;
		case "bottom": return end.y >= start.y;
		case "top": return end.y <= start.y;
	}
}

function isTimelineStructuralPath(pathId: string) {
	return pathId.endsWith("-timeline-connector")
		|| pathId.includes("-timeline-activity-")
		|| pathId.endsWith("-h")
		|| pathId.endsWith("-v-axis");
}

export function resolveLayoutGeometry(
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	nodeToMapRoot: Map<string, MindmapNode>,
	defaultConnectionStyle: "curved" | "orthogonal" | "straight",
		defaultLayoutType?: string,
		freeLayout = false,
		routeCache?: Map<string, string>,
		autoPositions?: Map<string, { x: number; y: number }>,
) {
	packMindmapNodes(positioned, nodeToMapRoot, defaultLayoutType, freeLayout);
	const positionedById = new Map(positioned.map((node) => [node.id, node]));
	const ids = new Set(positionedById.keys());
	const mapFingerprints = new Map<string, string>();

	const getMapFingerprint = (mapRootId: string): string => {
		if (!mapFingerprints.has(mapRootId)) {
			const fp = positioned
				.filter((n) => nodeToMapRoot.get(n.id)?.id === mapRootId)
				.map((n) => `${n.id}:${Math.round(n.x)},${Math.round(n.y)},${n.width},${n.height}`)
				.sort()
				.join("|");
			mapFingerprints.set(mapRootId, fp);
		}
		return mapFingerprints.get(mapRootId)!;
	};

	for (const path of connections) {
		const pair = parsePathId(path.id, positioned, ids);
		if (!pair) continue;
		const parent = positionedById.get(pair.parentId);
		const child = positionedById.get(pair.childId);
		if (!parent || !child) continue;
		if (path.groupRotation) continue;
		if (child.node.style?.noParentConnection) continue;
		const mapRoot = nodeToMapRoot.get(parent.id);
		const layoutType = mapRoot?.style?.layoutType ?? defaultLayoutType;
		const resolved = layoutType
			? resolveMapLayout(layoutType as LayoutType, mapRoot?.style)
			: null;
		if (
			resolved?.family === "catalog"
			|| (resolved?.family === "timeline" && (resolved.isCanonical || isTimelineStructuralPath(path.id)))
		) {
			continue;
		}
		// Fishbone edge geometry is owned by `runLayoutFishbone` (auto maps) and
		// `routeFishboneEdge` via routeLayoutPaths (displaced nodes) — see
		// fishboneEdges.ts. Re-routing here would discard the rib shape the layout
		// engine computed, which is why obstacle routing must skip it entirely.
		if (mapRoot && layoutType === "fishbone") continue;

		const mapId = mapRoot?.id ?? "__global__";
		const mapConnectionStyle = mapRoot?.style?.connectionStyle ?? defaultConnectionStyle;
			const isMapRootEdge = parent.id === mapRoot?.id && parent.node.floating && !child.node.floating;
			const usesFreeGeometry = isFreeFormMap(mapRoot)
				|| (freeLayout && !autoPositions)
				|| (freeLayout && !isMapRootEdge && (parent.node.floating || child.node.floating))
				|| (parent.node.floating && child.node.floating);
		const cacheKey = routeCache
			? `${path.id}|${getMapFingerprint(mapId)}|${mapConnectionStyle}|${layoutType ?? "default"}|${usesFreeGeometry ? "free" : "auto"}`
			: null;
		if (cacheKey && routeCache!.has(cacheKey)) {
			path.d = routeCache!.get(cacheKey)!;
			continue;
		}

		const style = child.node.style?.lineType
			?? mapRoot?.style?.connectionStyle
			?? defaultConnectionStyle;

		// In free layout, a tree edge is no longer constrained by its source
		// layout's hierarchy. Route it from the nearest node sides around every
		// node in its map; flowchart/swimlane's fixed vertical anchors would
		// otherwise cut through moved nodes.
		if (usesFreeGeometry) {
			// Bundling reads as one trunk splitting into children — apply it to
			// every branching parent (2+ children), not just the map root, so a
			// deeper node's own children converge the same way the root's do.
			const bundlesFreeBranches = style === "curved"
				&& (parent.node.children?.length ?? 0) > 1
				&& (layoutType === "logical-right" || layoutType === "logical-left" || layoutType === "mindmap"
					|| layoutType === "mindmap-vertical" || layoutType === "org-chart");
			if (bundlesFreeBranches) {
				const [fromSide, toSide] = hierarchySides(mapRoot, layoutType, parent, child);
				const start = anchorPoint(parent, fromSide);
				const end = anchorPoint(child, toSide);
				if (trunkDirectionIsSane(fromSide, start, end)) {
					const isVerticalEdge = fromSide === "top" || fromSide === "bottom";
					path.d = isVerticalEdge
						? bezierVWithSharedTrunk(start.x, start.y, end.x, end.y)
						: bezierHWithSharedTrunk(start.x, start.y, end.x, end.y);
					if (cacheKey) routeCache!.set(cacheKey, path.d);
					continue;
				}
			}
			const mapNodes = positioned.filter((node) =>
				nodeToMapRoot.get(node.id)?.id === mapRoot?.id
			);
			const route = findBestOrthogonalRoute(parent, child, mapNodes);
			path.d = routeToPath(route, style);
			if (cacheKey) routeCache!.set(cacheKey, path.d);
			continue;
		}

		// Swimlane and flowchart: tree connections go straight center-to-center
		// (top→bottom). Obstacle routing causes diagonal paths when sibling lanes
		// have nodes at similar y-positions and are treated as obstacles.
			if (layoutType === "flowchart") {
				const startX = parent.x + parent.width;
				const startY = parent.y;
				const endX = child.x;
				const endY = child.y;
				if (style === "straight") {
					path.d = `M ${startX} ${startY} L ${endX} ${endY}`;
				} else if (style === "orthogonal") {
					const mapNodes = positioned.filter((node) =>
						nodeToMapRoot.get(node.id)?.id === mapRoot?.id
					);
					const route = findBestOrthogonalRoute(parent, child, mapNodes, "right", "left");
					path.d = routeToPath(route, style);
				} else {
					path.d = bezierH(startX, startY, endX, endY);
				}
				if (cacheKey) routeCache!.set(cacheKey, path.d);
				continue;
			}

			if (layoutType === "swimlane") {
				const startX = parent.x + parent.width / 2;
				const childIsBelow = child.y >= parent.y;
				const startY = parent.y + (childIsBelow ? parent.height / 2 : -parent.height / 2);
				const endX = child.x + child.width / 2;
				const endY = child.y + (childIsBelow ? -child.height / 2 : child.height / 2);
			if (style === "straight") {
				path.d = `M ${startX} ${startY} L ${endX} ${endY}`;
			} else if (style === "orthogonal") {
				const midY = (startY + endY) / 2;
				path.d = startX === endX
					? `M ${startX} ${startY} V ${endY}`
					: `M ${startX} ${startY} V ${midY} H ${endX} V ${endY}`;
			} else {
				path.d = bezierV(startX, startY, endX, endY);
			}
			if (cacheKey) routeCache!.set(cacheKey, path.d);
			continue;
		}

		// "straight" means a direct A→B line — skip obstacle routing which always
		// produces multi-waypoint orthogonal paths, making straight look like elbow.
		if (style === "straight") {
			const [fromSide, toSide] = hierarchySides(mapRoot, layoutType, parent, child);
			const start = anchorPoint(parent, fromSide);
			const end = anchorPoint(child, toSide);
			path.d = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
			if (cacheKey) routeCache!.set(cacheKey, path.d);
			continue;
		}
		const mapNodes = positioned.filter((node) =>
			nodeToMapRoot.get(node.id)?.id === mapRoot?.id
		);
		const [fromSide, toSide] = hierarchySides(mapRoot, layoutType, parent, child);
		const route = findBestOrthogonalRoute(
			parent,
			child,
			mapNodes,
			fromSide,
			toSide,
		);
		// Applies at every branching parent (2+ children), not just the map
		// root — see the matching free-geometry comment above.
		const bundlesBranches = style === "curved"
			&& !usesFreeGeometry
			&& (parent.node.children?.length ?? 0) > 1
			&& (layoutType === "logical-right" || layoutType === "logical-left" || layoutType === "mindmap"
				|| layoutType === "mindmap-vertical" || layoutType === "org-chart");
		const bundleAnchors = bundlesBranches
			? { start: anchorPoint(parent, fromSide), end: anchorPoint(child, toSide) }
			: null;
		if (bundleAnchors && trunkDirectionIsSane(fromSide, bundleAnchors.start, bundleAnchors.end)) {
			const { start, end } = bundleAnchors;
			const isVerticalEdge = fromSide === "top" || fromSide === "bottom";
			path.d = isVerticalEdge
				? bezierVWithSharedTrunk(start.x, start.y, end.x, end.y)
				: bezierHWithSharedTrunk(start.x, start.y, end.x, end.y);
		} else {
			path.d = routeToPath(route, style);
		}
		if (cacheKey) routeCache!.set(cacheKey, path.d);
	}
}
