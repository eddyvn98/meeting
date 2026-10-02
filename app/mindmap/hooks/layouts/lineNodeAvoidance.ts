import type { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import { parsePathId, type ConnectionPath, type PositionedNode } from "./layoutHelpers";

const CLEARANCE = 8;

type Point = { x: number; y: number };
type Rect = { left: number; right: number; top: number; bottom: number };

function nodeRect(node: PositionedNode): Rect {
	return {
		left: node.x - CLEARANCE,
		right: node.x + node.width + CLEARANCE,
		top: node.y - node.height / 2 - CLEARANCE,
		bottom: node.y + node.height / 2 + CLEARANCE,
	};
}

function clipAxis(p: number, q: number, range: [number, number]): [number, number] | null {
	if (p === 0) return q < 0 ? null : range;
	const r = q / p;
	if (p < 0) return r > range[1] ? null : [Math.max(range[0], r), range[1]];
	return r < range[0] ? null : [range[0], Math.min(range[1], r)];
}

/** Parametric range (t in [0,1]) where segment a→b lies inside rect, or null if it never enters. */
function segmentRectOverlap(a: Point, b: Point, rect: Rect): [number, number] | null {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	let range: [number, number] | null = [0, 1];
	const checks: [number, number][] = [
		[-dx, a.x - rect.left],
		[dx, rect.right - a.x],
		[-dy, a.y - rect.top],
		[dy, rect.bottom - a.y],
	];
	for (const [p, q] of checks) {
		range = clipAxis(p, q, range!);
		if (!range) return null;
	}
	return range[0] <= range[1] ? range : null;
}

function segmentCrossesRect(a: Point, b: Point, rect: Rect): boolean {
	const overlap = segmentRectOverlap(a, b, rect);
	if (!overlap) return false;
	// Touching only at a shared endpoint (t≈0 or t≈1) isn't a crossing.
	return overlap[1] - overlap[0] > 0.001 && overlap[1] > 0.02 && overlap[0] < 0.98;
}

function detourViaCorner(a: Point, b: Point, rect: Rect): Point[] | null {
	const corners: Point[] = [
		{ x: rect.left, y: rect.top },
		{ x: rect.right, y: rect.top },
		{ x: rect.left, y: rect.bottom },
		{ x: rect.right, y: rect.bottom },
	];
	const distance = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
	const ranked = corners
		.map((corner) => ({ corner, cost: distance(a, corner) + distance(corner, b) }))
		.sort((x, y) => x.cost - y.cost);
	for (const { corner } of ranked) {
		if (!segmentCrossesRect(a, corner, rect) && !segmentCrossesRect(corner, b, rect)) {
			return [a, corner, b];
		}
	}
	return null;
}

function parseSimpleLine(d: string): [Point, Point] | null {
	const match = d.match(
		/^M\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)\s+(-?\d*\.?\d+(?:e[-+]?\d+)?)\s+L\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)\s+(-?\d*\.?\d+(?:e[-+]?\d+)?)$/i
	);
	if (!match) return null;
	const [, x1, y1, x2, y2] = match.map(Number) as unknown as number[];
	return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
}

function formatPolyline(points: Point[]): string {
	return points.map((p, index) => `${index ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
}

/**
 * Straight point-to-point connectors (fishbone entries, floating-node links,
 * "straight" style routes) are computed per-branch with no awareness of other
 * branches in the same map. When two branches share screen space, a line from
 * one can cut straight through an unrelated node from another. This pass runs
 * last, after every layout has placed its final node positions, and bends
 * only the specific segments that actually cross a foreign node's box.
 *
 * Scoped to nodes sharing the same map root: separate maps on the same canvas
 * are a deliberately isolated concern (dragging one map must not change
 * another map's rendering, see multi-map-drag-alignment.test.ts) — cross-map
 * overlap needs to be solved by keeping map bounding boxes apart, not by
 * reactively bending lines across map boundaries.
 */
export function avoidLineNodeOverlaps(
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	nodeToMapRoot: Map<string, MindmapNode>,
) {
	const idSet = new Set(positioned.map((node) => node.id));
	const nodesByMapRoot = new Map<string, PositionedNode[]>();
	for (const node of positioned) {
		const mapRootId = nodeToMapRoot.get(node.id)?.id;
		if (!mapRootId) continue;
		const bucket = nodesByMapRoot.get(mapRootId);
		if (bucket) bucket.push(node);
		else nodesByMapRoot.set(mapRootId, [node]);
	}

	for (const path of connections) {
		const line = parseSimpleLine(path.d);
		if (!line) continue;
		const parsed = parsePathId(path.id, positioned, idSet);
		const mapRootId = parsed && nodeToMapRoot.get(parsed.parentId)?.id;
		const candidates = mapRootId ? nodesByMapRoot.get(mapRootId) : undefined;
		if (!candidates) continue;
		const [start, end] = line;
		for (const node of candidates) {
			if (path.id.includes(node.id)) continue;
			const rect = nodeRect(node);
			if (!segmentCrossesRect(start, end, rect)) continue;
			const detoured = detourViaCorner(start, end, rect);
			if (detoured) {
				path.d = formatPolyline(detoured);
				break;
			}
		}
	}
}
