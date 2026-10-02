"use client";

import { ConnectionPath, PositionedNode } from "./layoutHelpers";

const RIB_MIN_TICK = 12;

/**
 * Single source of truth for fishbone edge geometry.
 *
 * Ownership rule — a fishbone edge is drawn by exactly one place:
 *  - Auto-positioned map: `runLayoutFishbone` emits the rib path (diagonal +
 *    horizontal tick) and no later pass may overwrite it.
 *  - Node moved off its auto position (free layout, or a floating node inside
 *    an auto map): `routeFishboneEdge` re-aims the edge point-to-point, because
 *    the rib the layout computed no longer reaches the node.
 *  - Live drag preview: `dragPathHelpers` reuses `fishboneEdgePoint` directly.
 *
 * Anything that needs a fishbone endpoint must come through here rather than
 * re-deriving it, otherwise the later pass silently wins and edits to the
 * layout engine stop showing up on screen.
 */
export function fishboneEdgePoint(
	cx: number,
	cy: number,
	width: number,
	height: number,
	towardX: number,
	towardY: number
) {
	if (towardX === 0 && towardY === 0) return { x: cx, y: cy };
	const halfW = width / 2;
	const halfH = height / 2;
	const scaleX = towardX !== 0 ? halfW / Math.abs(towardX) : Number.POSITIVE_INFINITY;
	const scaleY = towardY !== 0 ? halfH / Math.abs(towardY) : Number.POSITIVE_INFINITY;
	const scale = Math.min(scaleX, scaleY);
	return { x: cx + towardX * scale, y: cy + towardY * scale };
}

/** Straight edge-to-edge link between a moved parent/child pair. */
export function routeFishboneEdge(
	path: ConnectionPath,
	parent: PositionedNode,
	child: PositionedNode
) {
	const parentX = parent.x + parent.width / 2;
	const childX = child.x + child.width / 2;
	const start = fishboneEdgePoint(
		parentX, parent.y, parent.width, parent.height,
		childX - parentX, child.y - parent.y
	);
	const end = fishboneEdgePoint(
		childX, child.y, child.width, child.height,
		parentX - childX, parent.y - child.y
	);
	path.d = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

/** Rebuild a displaced sibling cluster as one diagonal rib with connected ticks. */
export function routeFishboneSiblingGroup(
	rib: ConnectionPath,
	ticksByChildId: Map<string, ConnectionPath>,
	parent: PositionedNode,
	children: PositionedNode[]
) {
	if (!children.length) return [];
	const direction = children[0].y >= parent.y ? 1 : -1;
	const startX = parent.x + parent.width;
	const startY = parent.y + direction * parent.height / 2;
	const nearEdgeY = (child: PositionedNode) => child.y - direction * child.height / 2;
	const last = children[children.length - 1];
	const ribEndX = Math.max(startX + RIB_MIN_TICK, last.x - RIB_MIN_TICK);
	const ribSpan = nearEdgeY(last) - startY;
	rib.d = `M ${startX} ${startY} L ${ribEndX} ${nearEdgeY(last)}`;

	const pathIds = [rib.id];
	children.forEach((child) => {
		const tick = ticksByChildId.get(child.id);
		if (!tick) return;
		const childEdgeY = nearEdgeY(child);
		const ratio = ribSpan === 0 ? 1 : (childEdgeY - startY) / ribSpan;
		const axisX = Math.round(startX + (ribEndX - startX) * Math.min(1, Math.max(0, ratio)));
		tick.d = `M ${axisX} ${childEdgeY} L ${child.x} ${childEdgeY}`;
		pathIds.push(tick.id);
	});
	return pathIds;
}
