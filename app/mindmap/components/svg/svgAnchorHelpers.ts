import { PositionedNode } from "@/app/mindmap/hooks/usePageLayout";
import { MindmapRelationship } from "@/components/features/chat/mindmap/mindmap-types";
import {
	findBestOrthogonalRoute,
	routeToPath,
} from "../../hooks/layouts/obstacleRouter";
import { normalizeOrthogonalPathPoints } from "./svgPathHelpers";

// A manually-routed connector (dragged from a specific port, e.g. "bottom" ->
// "top") keeps those exact ports on every future render — see the comment on
// handleAddRelationship in usePageRelationships.ts. That is the right default
// (it preserves what the user actually drew), but it stops making sense once
// the two nodes are later dragged into perfect alignment on the OTHER axis:
// forcing a vertical (top/bottom) pair on two nodes now centered on the same
// row, or a horizontal (left/right) pair on two nodes now centered on the
// same column, produces a needless jog even though the node-alignment guide
// (computeAlignmentSnap, which only ever looks at raw node bounds and knows
// nothing about connector ports) correctly reports the pair as aligned. That
// mismatch is what makes the connector look "out of sync" with its own align
// guide. Falling back to auto side selection in just that degenerate case
// keeps every other manual routing choice untouched.
const PORT_ALIGNMENT_EPS = 0.5;

function pinnedSidesFightAlignment(
	fromNode: PositionedNode,
	toNode: PositionedNode,
	fromSide?: "left" | "right" | "top" | "bottom",
	toSide?: "left" | "right" | "top" | "bottom",
): boolean {
	const isVertical = (side?: string) => side === "top" || side === "bottom";
	const isHorizontal = (side?: string) => side === "left" || side === "right";
	if (isVertical(fromSide) && isVertical(toSide)) {
		return Math.abs(fromNode.y - toNode.y) <= PORT_ALIGNMENT_EPS;
	}
	if (isHorizontal(fromSide) && isHorizontal(toSide)) {
		const fromCenterX = fromNode.x + fromNode.width / 2;
		const toCenterX = toNode.x + toNode.width / 2;
		return Math.abs(fromCenterX - toCenterX) <= PORT_ALIGNMENT_EPS;
	}
	return false;
}

export function getOptimalAnchors(
	fromNode: PositionedNode,
	toNode: PositionedNode,
	explicitFromSide?: "left" | "right" | "top" | "bottom",
	explicitToSide?: "left" | "right" | "top" | "bottom",
	nodes?: PositionedNode[],
) {
	const relaxPinnedSides = pinnedSidesFightAlignment(fromNode, toNode, explicitFromSide, explicitToSide);
	const fromSide = relaxPinnedSides ? undefined : explicitFromSide;
	const toSide = relaxPinnedSides ? undefined : explicitToSide;
	if (nodes) {
		const route = findBestOrthogonalRoute(
			fromNode,
			toNode,
			nodes,
			fromSide,
			toSide,
		);
		return { fromPoint: route[0], toPoint: route[route.length - 1] };
	}
	const fromAnchors = [
		{ x: fromNode.x, y: fromNode.y, side: "left" },
		{ x: fromNode.x + fromNode.width, y: fromNode.y, side: "right" },
		{ x: fromNode.x + fromNode.width / 2, y: fromNode.y - fromNode.height / 2, side: "top" },
		{ x: fromNode.x + fromNode.width / 2, y: fromNode.y + fromNode.height / 2, side: "bottom" },
	];
	const toAnchors = [
		{ x: toNode.x, y: toNode.y, side: "left" },
		{ x: toNode.x + toNode.width, y: toNode.y, side: "right" },
		{ x: toNode.x + toNode.width / 2, y: toNode.y - toNode.height / 2, side: "top" },
		{ x: toNode.x + toNode.width / 2, y: toNode.y + toNode.height / 2, side: "bottom" },
	];

	let bestFrom = fromAnchors.find(a => a.side === fromSide) || null;
	let bestTo = toAnchors.find(a => a.side === toSide) || null;

	if (bestFrom && bestTo) {
		return { fromPoint: bestFrom, toPoint: bestTo };
	}

	let minDistance = Infinity;
	bestFrom = fromAnchors[0];
	bestTo = toAnchors[0];

	for (const fa of fromAnchors) {
		for (const ta of toAnchors) {
			const dist = Math.hypot(fa.x - ta.x, fa.y - ta.y);
			if (dist < minDistance) {
				minDistance = dist;
				bestFrom = fa;
				bestTo = ta;
			}
		}
	}
	return { fromPoint: bestFrom, toPoint: bestTo };
}

function buildWaypointPath(
	sX: number, sY: number,
	eX: number, eY: number,
	type: "straight" | "orthogonal" | "curved" | "straight_arrow",
	waypoints: Array<{ x: number; y: number }>
): string {
	const pts = [{ x: sX, y: sY }, ...waypoints, { x: eX, y: eY }];

	if (type === "orthogonal") {
		// A blind "H then V" elbow between each consecutive pair assumes every
		// leg leaves a point horizontally first, which is wrong whenever the
		// actual corner needs to be vertical-then-horizontal — that adds a
		// spurious near-zero-length extra segment (a phantom drag handle with
		// no visible bend). normalizeOrthogonalPathPoints — the same helper
		// buildOrthogonalPath below uses for orthogonalWaypoints — rebuilds the
		// minimal, correctly-alternating polyline through the same points.
		const normalized = normalizeOrthogonalPathPoints(pts);
		return normalized.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
	}

	if (type === "curved") {
		if (pts.length === 2) {
			// No waypoints: standard S-curve
			const cp1x = sX + (eX - sX) * 0.4;
			const cp2x = sX + (eX - sX) * 0.6;
			return `M ${sX} ${sY} C ${cp1x} ${sY}, ${cp2x} ${eY}, ${eX} ${eY}`;
		}
		// Catmull-Rom spline converted to cubic bezier segments.
		// Path passes smoothly through every waypoint with natural curvature.
		// Phantom points duplicate the endpoints so boundary tangents are well-defined.
		const ext = [pts[0], ...pts, pts[pts.length - 1]];
		let d = `M ${pts[0].x} ${pts[0].y}`;
		for (let i = 0; i < pts.length - 1; i++) {
			const p0 = ext[i], p1 = ext[i + 1], p2 = ext[i + 2], p3 = ext[i + 3];
			const cp1x = p1.x + (p2.x - p0.x) / 6;
			const cp1y = p1.y + (p2.y - p0.y) / 6;
			const cp2x = p2.x - (p3.x - p1.x) / 6;
			const cp2y = p2.y - (p3.y - p1.y) / 6;
			d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
		}
		return d;
	}

	// straight / straight_arrow: simple polyline through all points
	return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

function buildOrthogonalPath(
	sX: number, sY: number,
	eX: number, eY: number,
	waypoints: Array<{ x: number; y: number }>,
): string {
	const points = normalizeOrthogonalPathPoints([{ x: sX, y: sY }, ...waypoints, { x: eX, y: eY }]);
	return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

export function getRelationshipPathD(
	sX: number, sY: number,
	eX: number, eY: number,
	type: "straight" | "orthogonal" | "curved" | "straight_arrow",
	nodes?: PositionedNode[],
	fromId?: string,
	toId?: string,
	fromSide?: "left" | "right" | "top" | "bottom",
	toSide?: "left" | "right" | "top" | "bottom",
	offset?: { x: number; y: number },
	waypoints?: Array<{ x: number; y: number }>,
	orthogonalWaypoints?: Array<{ x: number; y: number }>,
) {
	if (type === "orthogonal" && orthogonalWaypoints && orthogonalWaypoints.length > 0) {
		return buildOrthogonalPath(sX, sY, eX, eY, orthogonalWaypoints);
	}
	// New waypoints system takes priority over legacy controlPointOffset
	if (waypoints && waypoints.length > 0) {
		return buildWaypointPath(sX, sY, eX, eY, type, waypoints);
	}
	const hasManualOffset = !!offset && (offset.x !== 0 || offset.y !== 0);
	if (nodes && fromId && toId && !hasManualOffset) {
		const fromNode = nodes.find((node) => node.id === fromId);
		const toNode = nodes.find((node) => node.id === toId);
		if (fromNode && toNode) {
			// Same relaxation as getOptimalAnchors: a pinned manual port pair that
			// fights the nodes' current alignment (see pinnedSidesFightAlignment's
			// doc comment above) must not be re-applied here either, or the route
			// this function builds would ignore the already-relaxed sX/sY/eX/eY it
			// was called with and re-derive a bent path from the stale ports.
			const relaxPinnedSides = pinnedSidesFightAlignment(fromNode, toNode, fromSide, toSide);
			const route = findBestOrthogonalRoute(
				fromNode,
				toNode,
				nodes,
				relaxPinnedSides ? undefined : fromSide,
				relaxPinnedSides ? undefined : toSide,
			);
			return routeToPath(route, type === "straight_arrow" ? "straight" : type);
		}
	}
	const defaultMidX = (sX + eX) / 2;
	const defaultMidY = (sY + eY) / 2;
	const controlX = defaultMidX + (offset?.x || 0);
	const controlY = defaultMidY + (offset?.y || 0);

	if (type === "straight" || type === "straight_arrow") {
		if (offset && (offset.x !== 0 || offset.y !== 0)) {
			return `M ${sX} ${sY} L ${controlX} ${controlY} L ${eX} ${eY}`;
		}
		return `M ${sX} ${sY} L ${eX} ${eY}`;
	}
	if (type === "orthogonal" && offset && (offset.x !== 0 || offset.y !== 0)) {
		if (fromSide === "top" || fromSide === "bottom") {
			return `M ${sX} ${sY} V ${controlY} H ${eX} V ${eY}`;
		} else {
			return `M ${sX} ${sY} H ${controlX} V ${eY} H ${eX}`;
		}
	}
	if (type === "orthogonal" && nodes && fromId && toId) {
		const otherNodes = nodes.filter(n => n.id !== fromId && n.id !== toId);

		const checkVerticalIntersection = (x: number, y1: number, y2: number) => {
			const minY = Math.min(y1, y2);
			const maxY = Math.max(y1, y2);
			return otherNodes.some(n => {
				const nodeMinY = n.y - n.height / 2;
				const nodeMaxY = n.y + n.height / 2;
				// Check if x is inside the node's horizontal span (with 8px safety margin)
				const inX = x >= n.x - 8 && x <= n.x + n.width + 8;
				// Check if vertical segment overlaps with the node's vertical span
				const inY = maxY >= nodeMinY - 8 && minY <= nodeMaxY + 8;
				return inX && inY;
			});
		};

		const checkHorizontalIntersection = (y: number, x1: number, x2: number) => {
			const minX = Math.min(x1, x2);
			const maxX = Math.max(x1, x2);
			return otherNodes.some(n => {
				const nodeMinY = n.y - n.height / 2;
				const nodeMaxY = n.y + n.height / 2;
				// Check if y is inside the node's vertical span (with 8px safety margin)
				const inY = y >= nodeMinY - 8 && y <= nodeMaxY + 8;
				// Check if horizontal segment overlaps with the node's horizontal span
				const inX = maxX >= n.x - 8 && minX <= n.x + n.width + 8;
				return inY && inX;
			});
		};

		const defaultMid = (sX + eX) / 2;

		// If default mid doesn't intersect anything, use it directly
		if (!checkVerticalIntersection(defaultMid, sY, eY) &&
			!checkHorizontalIntersection(sY, sX, defaultMid) &&
			!checkHorizontalIntersection(eY, defaultMid, eX)) {
			return `M ${sX} ${sY} H ${defaultMid} V ${eY} H ${eX}`;
		}

		// Otherwise, sample 9 candidate X values across the span
		let bestX = defaultMid;
		let minPenalty = Infinity;

		const step = (eX - sX) / 10;
		for (let i = 1; i <= 9; i++) {
			const candidateX = sX + step * i;
			let penalty = 0;

			if (checkVerticalIntersection(candidateX, sY, eY)) penalty += 1000;
			if (checkHorizontalIntersection(sY, sX, candidateX)) penalty += 1000;
			if (checkHorizontalIntersection(eY, candidateX, eX)) penalty += 1000;

			// Small penalty for moving away from center to keep paths neat
			penalty += Math.abs(candidateX - defaultMid) * 0.1;

			if (penalty < minPenalty) {
				minPenalty = penalty;
				bestX = candidateX;
			}
		}

		return `M ${sX} ${sY} H ${bestX} V ${eY} H ${eX}`;
	}

	if (type === "orthogonal") {
		const midX = (sX + eX) / 2;
		return `M ${sX} ${sY} H ${midX} V ${eY} H ${eX}`;
	}
	if (type === "curved") {
		if (offset && (offset.x !== 0 || offset.y !== 0)) {
			return `M ${sX} ${sY} Q ${controlX} ${controlY}, ${eX} ${eY}`;
		}
		const cp1x = sX + (eX - sX) * 0.4;
		const cp2x = sX + (eX - sX) * 0.6;
		return `M ${sX} ${sY} C ${cp1x} ${sY}, ${cp2x} ${eY}, ${eX} ${eY}`;
	}
	return `M ${sX} ${sY} L ${eX} ${eY}`;
}
