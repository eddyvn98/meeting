import type { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import { catalogHierarchyRailX } from "./catalogColumns";
import { resolveMapLayout } from "./mapLayoutConfig";
import {
	bezierH,
	bezierHLeft,
	bezierV,
	ConnectionPath,
	parsePathId,
	PositionedNode,
} from "./layoutHelpers";
import { routeFishboneEdge, routeFishboneSiblingGroup } from "./fishboneEdges";
import { findBestOrthogonalRoute, routeToPath, type AnchorSide } from "./obstacleRouter";
import { collectStaleTimelineRails } from "./timelineRails";
import { isFreeFormMap } from "./layoutFreeForm";
import { getFloatingConnectorPathD } from "../../utils/floatingConnectorPath";

type LayoutType =
	| "logical-right" | "logical-left" | "mindmap" | "mindmap-vertical" | "org-chart" | "catalog"
	| "timeline" | "vertical-timeline" | "fishbone" | "flowchart" | "swimlane";

interface RouteLayoutPathsParams {
	connections: ConnectionPath[];
	positioned: PositionedNode[];
	positionedById: Map<string, PositionedNode>;
	nodeToMapRoot: Map<string, MindmapNode>;
	autoPositions: Map<string, { x: number; y: number }>;
	layoutType: LayoutType;
	connectionStyle: "curved" | "orthogonal" | "straight";
	freeLayout: boolean;
}

function positionChanged(
	node: PositionedNode,
	autoPositions: Map<string, { x: number; y: number }>,
	mapRoot?: PositionedNode,
) {
	const auto = autoPositions.get(node.id);
	if (!auto) return true;
	const rootAuto = mapRoot ? autoPositions.get(mapRoot.id) : undefined;
	const translateX = rootAuto ? mapRoot!.x - rootAuto.x : 0;
	const translateY = rootAuto ? mapRoot!.y - rootAuto.y : 0;
	return Math.abs(node.x - auto.x - translateX) > 0.01
		|| Math.abs(node.y - auto.y - translateY) > 0.01;
}

// Timeline path ids are not the bare `parentId-childId` pair parsePathId
// understands — they carry a layout-specific tail ("...-timeline-activity-stub",
// "...-h"). Node ids are UUID-like and hyphenated, so parsePathId's own naive
// split can't recover the pair either and returns null, which used to leave
// these edges permanently stuck at their auto-layout coordinates once the nodes
// they join were placed by hand (a floating draw-shape node and its children).
// Strip the known tail and re-parse so the routers below can take them over.
const EDGE_SUFFIXES = ["-timeline-activity-stub", "-timeline-connector", "-h"];

function parseSuffixedPathId(pathId: string, positioned: PositionedNode[], positionedIdSet: Set<string>) {
	const direct = parsePathId(pathId, positioned, positionedIdSet);
	if (direct) return direct;
	for (const suffix of EDGE_SUFFIXES) {
		if (!pathId.endsWith(suffix)) continue;
		const parsed = parsePathId(pathId.slice(0, -suffix.length), positioned, positionedIdSet);
		if (parsed) return parsed;
	}
	return null;
}

function isTimelineStructuralPath(pathId: string) {
	return pathId.endsWith("-timeline-connector")
		|| pathId.includes("-timeline-activity-")
		|| pathId.endsWith("-h")
		|| pathId.endsWith("-v-axis");
}

export function routeLayoutPaths({
	connections,
	positioned,
	positionedById,
	nodeToMapRoot,
	autoPositions,
	layoutType,
	connectionStyle,
	freeLayout,
}: RouteLayoutPathsParams) {
	const positionedIdSet = new Set(positioned.map((node) => node.id));
	const reroutedFishbonePathIds = new Set<string>();
	connections.filter((path) => path.id.endsWith("-siblings-rib")).forEach((rib) => {
		const parent = positioned.find((node) => rib.id === `${node.id}-siblings-rib`);
		if (!parent) return;
		const mapRoot = nodeToMapRoot.get(parent.id);
		const mapRootPosition = mapRoot ? positionedById.get(mapRoot.id) : undefined;
		const rawLayout = parent.node.style?.layoutType ?? mapRoot?.style?.layoutType ?? layoutType;
		const effectiveLayout = resolveMapLayout(rawLayout, parent.node.style?.layoutType ? parent.node.style : mapRoot?.style).engineLayoutType;
		if (effectiveLayout !== "fishbone") return;
		const children = (parent.node.children ?? [])
			.map((child) => positionedById.get(child.id))
			.filter((child): child is PositionedNode => !!child);
		const displaced = (node: PositionedNode) => node.node.floating
			|| (freeLayout && positionChanged(node, autoPositions, mapRootPosition));
		if (!displaced(parent) && !children.some(displaced)) return;
		const ticksByChildId = new Map(
			children.flatMap((child) => {
				const tick = connections.find((path) => path.id === `${parent.id}-${child.id}`);
				return tick ? [[child.id, tick] as const] : [];
			})
		);
		routeFishboneSiblingGroup(rib, ticksByChildId, parent, children)
			.forEach((pathId) => reroutedFishbonePathIds.add(pathId));
	});
	const staleRailIds = collectStaleTimelineRails(connections, positionedById, nodeToMapRoot, autoPositions, freeLayout);
	connections.forEach((path) => {
		if (reroutedFishbonePathIds.has(path.id)) return;
		const parsedIds = parseSuffixedPathId(path.id, positioned, positionedIdSet);
		if (!parsedIds) return;
		const parent = positionedById.get(parsedIds.parentId);
		const child = positionedById.get(parsedIds.childId);
		if (!parent || !child) return;

		const parentMapRoot = nodeToMapRoot.get(parent.id);
		const parentMapRootPosition = parentMapRoot
			? positionedById.get(parentMapRoot.id)
			: undefined;
		const lineStyle = child.node.style?.lineType
			?? parentMapRoot?.style?.connectionStyle
			?? connectionStyle;

		// A free-form map has no layout to fall back on, so every edge inside it is
		// routed box-to-box even when a node was never marked floating (pasted or
		// imported into the map, or created before the map became free-form).
		if ((parent.node.floating && child.node.floating) || isFreeFormMap(parentMapRoot)) {
			const groupTransform = sharedGroupTransform(parent, child);
			routeFloating(path, groupTransform ? inverseRotateNode(parent, groupTransform) : parent, groupTransform ? inverseRotateNode(child, groupTransform) : child, lineStyle, child.node.style?.connectorFromSide, child.node.style?.connectorToSide, child.node.style?.connectorWaypoints);
			path.groupRotation = groupTransform;
			return;
		}

		const rawLayout = parent.node.style?.layoutType
			?? parentMapRoot?.style?.layoutType
			?? layoutType;
		const style = parent.node.style?.layoutType
			? parent.node.style
			: parentMapRoot?.style;
		const effectiveLayout = resolveMapLayout(rawLayout, style).engineLayoutType;
		if (effectiveLayout === "timeline" || effectiveLayout === "vertical-timeline") {
			if (isTimelineStructuralPath(path.id)) return;
			if (
				!freeLayout
				|| (!positionChanged(parent, autoPositions, parentMapRootPosition)
					&& !positionChanged(child, autoPositions, parentMapRootPosition))
			) return;
		}
		if (effectiveLayout === "fishbone") {
			// The layout engine already emitted this rib. Only take it over when an
			// endpoint no longer sits where the engine put it — a free-layout drag,
			// or a floating node repositioned inside an otherwise auto map.
			const displaced = (node: PositionedNode) => node.node.floating
				|| (freeLayout && positionChanged(node, autoPositions));
			if (!displaced(parent) && !displaced(child)) return;
			routeFishboneEdge(path, parent, child);
			return;
		}

		if (effectiveLayout === "flowchart" || effectiveLayout === "swimlane") {
			return;
		}

		if (effectiveLayout === "org-chart" || effectiveLayout === "mindmap-vertical") {
			const isAbove = effectiveLayout === "mindmap-vertical" && child.y < parent.y;
			const startX = parent.x + parent.width / 2;
			const startY = parent.y + (isAbove ? -parent.height / 2 : parent.height / 2);
			const endX = child.x + child.width / 2;
			const endY = child.y + (isAbove ? child.height / 2 : -child.height / 2);
			path.d = lineStyle === "orthogonal"
				? `M ${startX} ${startY} V ${(startY + endY) / 2} H ${endX} V ${endY}`
				: lineStyle === "straight"
					? `M ${startX} ${startY} L ${endX} ${endY}`
					: bezierV(startX, startY, endX, endY);
		} else if (effectiveLayout === "catalog") {
			// Hierarchy-style treeview branches leave the parent's RIGHT edge and
			// meet the child's left edge, with the parent centered on its band —
			// the engine already emitted that bracket, so only re-derive it here
			// (same shape, current coordinates) instead of falling through to the
			// bottom-center spine the stacked treeview uses.
			const hierarchyBranch = (style?.catalogDescendantStyle ?? parentMapRoot?.style?.catalogDescendantStyle) === "hierarchy"
				&& parent.id !== parentMapRoot?.id;
			if (hierarchyBranch) {
				const railX = catalogHierarchyRailX(child.x);
				path.d = `M ${parent.x + parent.width} ${parent.y} L ${railX} ${parent.y} L ${railX} ${child.y} L ${child.x} ${child.y}`;
				return;
			}
			const startX = parent.x + parent.width / 2;
			const startY = parent.y + parent.height / 2;
			const railX = startX;
			const displaced = freeLayout && (
				parent.node.floating
				|| child.node.floating
				|| positionChanged(parent, autoPositions, parentMapRootPosition)
				|| positionChanged(child, autoPositions, parentMapRootPosition)
			);
			if (lineStyle === "orthogonal" && displaced) {
				const mapNodes = positioned.filter((node) =>
					nodeToMapRoot.get(node.id)?.id === parentMapRoot?.id
				);
				path.d = routeToPath(findBestOrthogonalRoute(parent, child, mapNodes, "left", "left"), lineStyle);
			} else {
				path.d = lineStyle === "curved"
					? `M ${startX} ${startY} Q ${railX} ${startY} ${railX} ${child.y} Q ${railX} ${child.y} ${child.x} ${child.y}`
					: `M ${startX} ${startY} L ${railX} ${child.y} L ${child.x} ${child.y}`;
			}
		} else if (
			effectiveLayout === "logical-left"
			|| (effectiveLayout === "mindmap" && child.x < parent.x)
		) {
			routeHorizontal(path, parent.x, parent.y, child.x + child.width, child.y, lineStyle);
		} else {
			routeHorizontal(path, parent.x + parent.width, parent.y, child.x, child.y, lineStyle);
		}
	});
	for (let index = connections.length - 1; index >= 0; index -= 1) {
		if (staleRailIds.has(connections[index].id)) connections.splice(index, 1);
	}
}

function sharedGroupTransform(parent: PositionedNode, child: PositionedNode) {
	const transform = parent.node.style?.groupTransform;
	return transform && transform.id === child.node.style?.groupTransform?.id ? transform : undefined;
}

function inverseRotateNode(node: PositionedNode, transform: NonNullable<ReturnType<typeof sharedGroupTransform>>) {
	const radians = -transform.angle * Math.PI / 180;
	const centerX = node.x + node.width / 2;
	const dx = centerX - transform.centerX;
	const dy = node.y - transform.centerY;
	return {
		...node,
		x: transform.centerX + dx * Math.cos(radians) - dy * Math.sin(radians) - node.width / 2,
		y: transform.centerY + dx * Math.sin(radians) + dy * Math.cos(radians),
	};
}

function routeFloating(
	path: ConnectionPath,
	parent: PositionedNode,
	child: PositionedNode,
	lineStyle: "curved" | "orthogonal" | "straight",
	fromSide?: AnchorSide,
	toSide?: AnchorSide,
	waypoints?: Array<{ x: number; y: number }>,
) {
	path.d = getFloatingConnectorPathD(parent, child, lineStyle, fromSide, toSide, waypoints);
}

function routeHorizontal(
	path: ConnectionPath,
	startX: number,
	startY: number,
	endX: number,
	endY: number,
	lineStyle: "curved" | "orthogonal" | "straight"
) {
	const goingLeft = endX < startX;
	if (lineStyle === "orthogonal") {
		const elbowX = startX + (goingLeft ? -30 : 30);
		path.d = `M ${startX} ${startY} H ${elbowX} V ${endY} H ${endX}`;
	} else if (lineStyle === "straight") {
		path.d = `M ${startX} ${startY} L ${endX} ${endY}`;
	} else {
		path.d = goingLeft
			? bezierHLeft(startX, startY, endX, endY)
			: bezierH(startX, startY, endX, endY);
	}
}
