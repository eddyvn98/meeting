import type { ConnectionPath, PositionedNode } from "../hooks/usePageLayout";
import { anchorPoint, type AnchorSide } from "../hooks/layouts/obstacleRouter";
import { getOptimalAnchors, getRelationshipPathD } from "../components/svg/svgAnchorHelpers";
import { projectConnectionPathForRotation } from "../components/svg/relationshipRotationProjection";
import { normalizeOrthogonalPathPoints } from "../components/svg/svgPathHelpers";

export type FloatingConnectorLineType = "curved" | "orthogonal" | "straight";
export type FloatingConnectorPoint = { x: number; y: number };

function buildWaypointPath(
	start: FloatingConnectorPoint,
	end: FloatingConnectorPoint,
	type: FloatingConnectorLineType,
	waypoints: Array<FloatingConnectorPoint>,
) {
	const points = [start, ...waypoints, end];
	if (type === "orthogonal") {
		// A blind "H then V" dogleg per waypoint (the old behavior) assumes every
		// leg leaves a point horizontally first, which is wrong whenever the wall
		// drag actually produced a vertical-then-horizontal corner — it then adds
		// a spurious near-zero-length extra segment at that corner, which is
		// exactly a phantom drag handle the user can grab for no visible bend.
		// normalizeOrthogonalPathPoints (same helper the free-relationship
		// orthogonal route uses) rebuilds the minimal, correctly-alternating
		// polyline through the same points instead.
		const normalized = normalizeOrthogonalPathPoints(points);
		return normalized.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
	}
	if (type === "curved") {
		if (points.length === 2) {
			const controlX = start.x + (end.x - start.x) * 0.5;
			return `M ${start.x} ${start.y} C ${controlX} ${start.y}, ${controlX} ${end.y}, ${end.x} ${end.y}`;
		}
		const extended = [points[0], ...points, points[points.length - 1]];
		let d = `M ${points[0].x} ${points[0].y}`;
		for (let i = 0; i < points.length - 1; i += 1) {
			const p0 = extended[i];
			const p1 = extended[i + 1];
			const p2 = extended[i + 2];
			const p3 = extended[i + 3];
			d += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`;
		}
		return d;
	}
	return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

/** Shared geometry for committed and in-progress floating connector routes. */
export function getFloatingConnectorPathFromPoints(
	start: FloatingConnectorPoint,
	end: FloatingConnectorPoint,
	type: FloatingConnectorLineType,
	fromSide?: AnchorSide,
	toSide?: AnchorSide,
	waypoints: Array<FloatingConnectorPoint> = [],
) {
	if (waypoints.length > 0) return buildWaypointPath(start, end, type, waypoints);
	if (type === "straight") return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;

	const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
	const routeHorizontal = fromSide ? fromSide === "left" || fromSide === "right" : horizontal;
	if (type === "orthogonal") {
		if (routeHorizontal) {
			const midX = (start.x + end.x) / 2;
			return `M ${start.x} ${start.y} H ${midX} V ${end.y} H ${end.x}`;
		}
		const midY = (start.y + end.y) / 2;
		return `M ${start.x} ${start.y} V ${midY} H ${end.x} V ${end.y}`;
	}

	if (horizontal) {
		const midX = (start.x + end.x) / 2;
		return `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`;
	}
	const midY = (start.y + end.y) / 2;
	return `M ${start.x} ${start.y} C ${start.x} ${midY}, ${end.x} ${midY}, ${end.x} ${end.y}`;
}

export function getFloatingConnectorPathD(
	parent: PositionedNode,
	child: PositionedNode,
	type: FloatingConnectorLineType,
	fromSide?: AnchorSide,
	toSide?: AnchorSide,
	waypoints: Array<FloatingConnectorPoint> = [],
) {
	const parentCenterX = parent.x + parent.width / 2;
	const childCenterX = child.x + child.width / 2;
	const deltaX = childCenterX - parentCenterX;
	const deltaY = child.y - parent.y;
	const horizontal = Math.abs(deltaX) >= Math.abs(deltaY);
	const left = deltaX < 0;
	const above = deltaY < 0;
	const resolvedFromSide = fromSide ?? (horizontal ? (left ? "left" : "right") : (above ? "top" : "bottom"));
	const resolvedToSide = toSide ?? (horizontal ? (left ? "right" : "left") : (above ? "bottom" : "top"));
	return getFloatingConnectorPathFromPoints(
		anchorPoint(parent, resolvedFromSide),
		anchorPoint(child, resolvedToSide),
		type,
		resolvedFromSide,
		resolvedToSide,
		waypoints,
	);
}

/**
 * Preserve the layout/obstacle route until a floating connector has an
 * explicit manual waypoint. The waypoint geometry is an editing override,
 * not a replacement for the automatic route.
 */
export function getFloatingConnectorRenderPath(
	path: ConnectionPath,
	parent: PositionedNode,
	child: PositionedNode,
	nodes: PositionedNode[],
) {
	const style = child.node.style ?? {};
	if (style.connectorWaypoints?.length) {
		return getFloatingConnectorPathD(
			parent,
			child,
			style.lineType ?? "curved",
			style.connectorFromSide,
			style.connectorToSide,
			style.connectorWaypoints,
		);
	}

	const projectedPath = projectConnectionPathForRotation(path.d, parent, child);
	if (!style.connectorFromSide && !style.connectorToSide) return projectedPath;

	const { fromPoint, toPoint } = getOptimalAnchors(
		parent,
		child,
		style.connectorFromSide,
		style.connectorToSide,
		nodes,
	);
	return getRelationshipPathD(
		fromPoint.x,
		fromPoint.y,
		toPoint.x,
		toPoint.y,
		style.lineType ?? "curved",
		nodes,
		parent.id,
		child.id,
		style.connectorFromSide,
		style.connectorToSide,
	);
}
