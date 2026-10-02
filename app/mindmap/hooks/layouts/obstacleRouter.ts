import type { PositionedNode } from "./layoutHelpers";
import { findGridOrthogonalRoute, isOrthogonalRouteClear } from "./orthogonalGridRouter";

export type AnchorSide = "left" | "right" | "top" | "bottom";
export type RoutePoint = { x: number; y: number; side?: AnchorSide };
type OrthogonalRoute = RoutePoint[] & { direct?: boolean };

const CLEARANCE = 12;
const NEAR_ALIGNMENT_TOLERANCE = 4;
const GRID_SEARCH_MARGIN = 420;
const GRID_CLEARANCE = 4;
const SIDES: AnchorSide[] = ["left", "right", "top", "bottom"];

export function anchorPoint(node: PositionedNode, side: AnchorSide): RoutePoint {
	if (side === "left") return { x: node.x, y: node.y, side };
	if (side === "right") return { x: node.x + node.width, y: node.y, side };
	if (side === "top") return { x: node.x + node.width / 2, y: node.y - node.height / 2, side };
	return { x: node.x + node.width / 2, y: node.y + node.height / 2, side };
}

function lead(point: RoutePoint) {
	if (point.side === "left") return { x: point.x - CLEARANCE, y: point.y };
	if (point.side === "right") return { x: point.x + CLEARANCE, y: point.y };
	if (point.side === "top") return { x: point.x, y: point.y - CLEARANCE };
	return { x: point.x, y: point.y + CLEARANCE };
}

function segmentHits(a: RoutePoint, b: RoutePoint, obstacles: PositionedNode[]) {
	for (const node of obstacles) {
		const left = node.x - CLEARANCE;
		const right = node.x + node.width + CLEARANCE;
		const top = node.y - node.height / 2 - CLEARANCE;
		const bottom = node.y + node.height / 2 + CLEARANCE;
		if (a.x === b.x && a.x > left && a.x < right
			&& Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom) return true;
		if (a.y === b.y && a.y > top && a.y < bottom
			&& Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right) return true;
	}
	return false;
}

function segmentIntersectsNode(a: RoutePoint, b: RoutePoint, node: PositionedNode) {
	const left = node.x - CLEARANCE;
	const right = node.x + node.width + CLEARANCE;
	const top = node.y - node.height / 2 - CLEARANCE;
	const bottom = node.y + node.height / 2 + CLEARANCE;
	let tMin = 0;
	let tMax = 1;
	for (const [origin, delta, min, max] of [
		[a.x, b.x - a.x, left, right],
		[a.y, b.y - a.y, top, bottom],
	] as const) {
		if (delta === 0) {
			if (origin < min || origin > max) return false;
			continue;
		}
		const t1 = (min - origin) / delta;
		const t2 = (max - origin) / delta;
		tMin = Math.max(tMin, Math.min(t1, t2));
		tMax = Math.min(tMax, Math.max(t1, t2));
		if (tMin > tMax) return false;
	}
	return tMax > 0 && tMin < 1;
}

function simplify(points: RoutePoint[]) {
	return points.filter((point, index) => {
		if (index === 0 || index === points.length - 1) return true;
		const previous = points[index - 1];
		const next = points[index + 1];
		return !((previous.x === point.x && point.x === next.x)
			|| (previous.y === point.y && point.y === next.y));
	});
}

function isContainedRoute(points: RoutePoint[]) {
	if (points.length < 2) return false;
	const start = points[0];
	const end = points[points.length - 1];
	const minX = Math.min(start.x, end.x);
	const maxX = Math.max(start.x, end.x);
	const minY = Math.min(start.y, end.y);
	const maxY = Math.max(start.y, end.y);
	return points.every((point) =>
		point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
	);
}

function directCurve(start: RoutePoint, end: RoutePoint) {
	if (Math.abs(start.x - end.x) >= Math.abs(start.y - end.y)) {
		const controlX = start.x + (end.x - start.x) / 2;
		return `M ${start.x} ${start.y} C ${controlX} ${start.y}, ${controlX} ${end.y}, ${end.x} ${end.y}`;
	}
	const controlY = start.y + (end.y - start.y) / 2;
	return `M ${start.x} ${start.y} C ${start.x} ${controlY}, ${end.x} ${controlY}, ${end.x} ${end.y}`;
}

function score(points: RoutePoint[]) {
	let length = 0;
	for (let index = 1; index < points.length; index += 1) {
		length += Math.abs(points[index].x - points[index - 1].x)
			+ Math.abs(points[index].y - points[index - 1].y);
	}
	return length + Math.max(0, points.length - 2) * 8;
}

function clear(points: RoutePoint[], obstacles: PositionedNode[]) {
	return points.every((point, index) =>
		index === 0 || !segmentHits(points[index - 1], point, obstacles)
	);
}

function collisionCount(points: RoutePoint[], obstacles: PositionedNode[]) {
	let hits = 0;
	for (let index = 1; index < points.length; index += 1) {
		if (segmentHits(points[index - 1], points[index], obstacles)) hits += 1;
	}
	return hits;
}

function routeBetween(start: RoutePoint, end: RoutePoint, obstacles: PositionedNode[], requireClear = true) {
	const minX = Math.min(start.x, end.x, ...obstacles.map((node) => node.x - CLEARANCE));
	const maxX = Math.max(start.x, end.x, ...obstacles.map((node) => node.x + node.width + CLEARANCE));
	const minY = Math.min(start.y, end.y, ...obstacles.map((node) => node.y - node.height / 2 - CLEARANCE));
	const maxY = Math.max(start.y, end.y, ...obstacles.map((node) => node.y + node.height / 2 + CLEARANCE));
	const middleX = (start.x + end.x) / 2;
	const middleY = (start.y + end.y) / 2;
	const candidates: RoutePoint[][] = [
		...(start.x === end.x || start.y === end.y ? [[start, end]] : []),
		[start, { x: end.x, y: start.y }, end],
		[start, { x: start.x, y: end.y }, end],
		[start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end],
		[start, { x: start.x, y: middleY }, { x: end.x, y: middleY }, end],
		[start, { x: minX - CLEARANCE, y: start.y }, { x: minX - CLEARANCE, y: end.y }, end],
		[start, { x: maxX + CLEARANCE, y: start.y }, { x: maxX + CLEARANCE, y: end.y }, end],
		[start, { x: start.x, y: minY - CLEARANCE }, { x: end.x, y: minY - CLEARANCE }, end],
		[start, { x: start.x, y: maxY + CLEARANCE }, { x: end.x, y: maxY + CLEARANCE }, end],
	];
	const simplified = candidates.map(simplify);
	if (requireClear) {
		const pool = simplified.filter((candidate) => clear(candidate, obstacles));
		return pool.sort((a, b) => score(a) - score(b))[0] ?? null;
	}
	// No candidate is fully clear (locked side pair + dense obstacles). Rather
	// than picking the shortest one regardless of collisions — which can cut
	// straight through an unrelated node in between — rank by how many
	// segments actually collide first, and use path length only to break ties
	// among equally-bad options.
	return simplified.sort((a, b) => {
		const collisionDiff = collisionCount(a, obstacles) - collisionCount(b, obstacles);
		return collisionDiff !== 0 ? collisionDiff : score(a) - score(b);
	})[0] ?? null;
}

export function findBestOrthogonalRoute(
	fromNode: PositionedNode,
	toNode: PositionedNode,
	nodes: PositionedNode[],
	explicitFromSide?: AnchorSide,
	explicitToSide?: AnchorSide,
) {
	// fromNode/toNode stay in the obstacle set too — excluding them let a route
	// swing back around and cut through the far side of its own start/end node
	// (e.g. a bottom-anchored approach clipping through the node's body from
	// another direction). Safe to include: `lead()` already pushes fromLead/
	// toLead CLEARANCE past the node's own boundary before routeBetween runs,
	// so the segment touching the anchor itself never collides with them.
	const obstacles = nodes;
	const fromSides = explicitFromSide ? [explicitFromSide] : SIDES;
	const toSides = explicitToSide ? [explicitToSide] : SIDES;
	const sidePairs = fromSides.flatMap((fromSide) =>
		toSides.map((toSide) => ({ fromSide, toSide }))
	).sort((a, b) => {
		const aFrom = anchorPoint(fromNode, a.fromSide);
		const aTo = anchorPoint(toNode, a.toSide);
		const bFrom = anchorPoint(fromNode, b.fromSide);
		const bTo = anchorPoint(toNode, b.toSide);
		return Math.abs(aFrom.x - aTo.x) + Math.abs(aFrom.y - aTo.y)
			- Math.abs(bFrom.x - bTo.x) - Math.abs(bFrom.y - bTo.y);
	});

	const fallbackCandidates: Array<{ route: OrthogonalRoute; collisions: number; length: number }> = [];
	for (const { fromSide, toSide } of sidePairs) {
		const from = anchorPoint(fromNode, fromSide);
		const to = anchorPoint(toNode, toSide);
		const fromLead = lead(from);
		const toLead = lead(to);
		const middle = routeBetween(fromLead, toLead, obstacles);
		if (middle) {
			const route = simplify([from, ...middle, to]) as OrthogonalRoute;
			const blockers = obstacles.filter((node) => node.id !== fromNode.id && node.id !== toNode.id);
			route.direct = !blockers.some((node) => segmentIntersectsNode(fromLead, toLead, node));
			return route;
		}
		const fallbackMiddle = routeBetween(fromLead, toLead, obstacles, false);
		if (fallbackMiddle) {
			fallbackCandidates.push({
				route: simplify([from, ...fallbackMiddle, to]) as OrthogonalRoute,
				collisions: collisionCount(fallbackMiddle, obstacles),
				length: score(fallbackMiddle),
			});
		}
	}
	if (sidePairs.length < SIDES.length * SIDES.length) {
		for (const fromSide of SIDES) {
			for (const toSide of SIDES) {
				if (sidePairs.some((pair) => pair.fromSide === fromSide && pair.toSide === toSide)) continue;
				const from = anchorPoint(fromNode, fromSide);
				const to = anchorPoint(toNode, toSide);
				const fallbackMiddle = routeBetween(lead(from), lead(to), obstacles, false);
				if (!fallbackMiddle) continue;
				fallbackCandidates.push({
					route: simplify([from, ...fallbackMiddle, to]) as OrthogonalRoute,
					collisions: collisionCount(fallbackMiddle, obstacles),
					length: score(fallbackMiddle),
				});
			}
		}
	}
	const minRouteX = Math.min(...sidePairs.map(({ fromSide }) => anchorPoint(fromNode, fromSide).x)) - GRID_SEARCH_MARGIN;
	const maxRouteX = Math.max(...sidePairs.map(({ fromSide }) => anchorPoint(fromNode, fromSide).x)) + GRID_SEARCH_MARGIN;
	const minTargetX = Math.min(...sidePairs.map(({ toSide }) => anchorPoint(toNode, toSide).x)) - GRID_SEARCH_MARGIN;
	const maxTargetX = Math.max(...sidePairs.map(({ toSide }) => anchorPoint(toNode, toSide).x)) + GRID_SEARCH_MARGIN;
	const minRouteY = Math.min(fromNode.y, toNode.y) - GRID_SEARCH_MARGIN;
	const maxRouteY = Math.max(fromNode.y, toNode.y) + GRID_SEARCH_MARGIN;
	const gridObstacles = obstacles.filter((node) => {
		const nodeRight = node.x + node.width + CLEARANCE;
		const nodeBottom = node.y + node.height / 2 + CLEARANCE;
		return node.id === fromNode.id || node.id === toNode.id
			|| (nodeRight >= Math.min(minRouteX, minTargetX)
				&& node.x - CLEARANCE <= Math.max(maxRouteX, maxTargetX)
				&& nodeBottom >= minRouteY
				&& node.y - node.height / 2 - CLEARANCE <= maxRouteY);
	});
	const gridFallbacks = sidePairs.flatMap(({ fromSide, toSide }) => {
		const from = anchorPoint(fromNode, fromSide);
		const to = anchorPoint(toNode, toSide);
		const middle = findGridOrthogonalRoute(lead(from), lead(to), gridObstacles, GRID_CLEARANCE);
		if (!middle) return [];
		const route = simplify([from, ...middle, to]) as OrthogonalRoute;
		// Validate the FULL route (including the anchor-to-lead entry/exit
		// stubs), not just the lead-to-lead `middle` segment. `lead()` pushes
		// each endpoint CLEARANCE (12px) away from its OWN node, but the grid
		// search above only guarantees `middle` is clear at GRID_CLEARANCE
		// (4px) around every OTHER obstacle. A lead point can sit just past
		// that 4px pad while still landing inside a nearby obstacle's real
		// box once its anchor-to-lead stub is spliced back on — `simplify()`
		// then collapses the whole anchor+lead+lead+anchor run into one
		// straight line that reaches further than `middle` ever validated,
		// silently cutting through the obstacle it was supposed to avoid.
		return isOrthogonalRouteClear(route, obstacles, 0) ? [{ route, length: score(route) }] : [];
	});
	const safeGridRoute = gridFallbacks.sort((a, b) => a.length - b.length)[0]?.route;
	if (safeGridRoute) return safeGridRoute;
	// No side pair cleared every obstacle (dense diagrams). Falling back to a
	// raw two-point line would cut straight through whatever blocked every
	// candidate — compare every side pair and prefer fewer collisions before
	// length. The shortest side pair is not necessarily the safest one in a
	// dense branch cluster.
	const bestFallback = fallbackCandidates.sort((a, b) =>
		a.collisions - b.collisions || a.length - b.length
	)[0];
	return bestFallback?.route ?? [
		anchorPoint(fromNode, sidePairs[0].fromSide),
		anchorPoint(toNode, sidePairs[0].toSide),
	];
}

export function routeToPath(points: RoutePoint[], style: "curved" | "orthogonal" | "straight") {
	if (points.length < 2) return "";
	if (style === "curved" && (points as OrthogonalRoute).direct && isContainedRoute(points)) {
		const start = points[0];
		const end = points[points.length - 1];
		return Math.abs(start.y - end.y) <= NEAR_ALIGNMENT_TOLERANCE
			? `M ${start.x} ${start.y} L ${end.x} ${start.y}`
			: Math.abs(start.x - end.x) <= NEAR_ALIGNMENT_TOLERANCE
				? `M ${start.x} ${start.y} L ${start.x} ${end.y}`
				: directCurve(start, end);
	}
	// When the route is a direct two-point line, "straight" draws it as a single
	// diagonal segment. When an obstacle forced a detour (more than two points),
	// falling back to that literal diagonal would cut straight through whatever
	// the route was built to avoid — so bent routes render as a straight-segment
	// polyline (same shape as "orthogonal") instead of collapsing to A-to-B.
	if (style === "straight" && points.length === 2) {
		const start = points[0];
		const end = points[points.length - 1];
		return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
	}
	if (style === "orthogonal" || style === "straight") {
		return points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
	}
	let d = `M ${points[0].x} ${points[0].y}`;
	for (let index = 1; index < points.length; index += 1) {
		const point = points[index];
		if (index === points.length - 1) {
			d += ` L ${point.x} ${point.y}`;
			continue;
		}
		const next = points[index + 1];
			const previous = points[index - 1];
			const radius = Math.min(
				24,
				(Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y)) / 2,
				(Math.abs(next.x - point.x) + Math.abs(next.y - point.y)) / 2,
			);
		const before = {
			x: point.x + Math.sign(previous.x - point.x) * radius,
			y: point.y + Math.sign(previous.y - point.y) * radius,
		};
		const after = {
			x: point.x + Math.sign(next.x - point.x) * radius,
			y: point.y + Math.sign(next.y - point.y) * radius,
		};
		d += ` L ${before.x} ${before.y} Q ${point.x} ${point.y} ${after.x} ${after.y}`;
	}
	return d;
}
