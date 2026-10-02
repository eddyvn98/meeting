import type { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import type { ConnectionPath, PositionedNode } from "./layoutHelpers";

// A timeline rail ("-v-axis", "-timeline-activity-axis") is pure auto-layout
// scaffolding with no parent/child pair at all, so nothing can ever re-route it.
// Once the nodes it was drawn around are placed by hand it stays behind at the
// abandoned coordinates as a stray bracket floating off to the side, while the
// parent→child edges — which DO get re-routed — already draw the whole connector
// on their own.
const RAIL_SUFFIXES = ["-v-axis", "-timeline-activity-axis"];

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

/** Ids of rails whose nodes no longer sit where the engine put them. */
export function collectStaleTimelineRails(
	connections: ConnectionPath[],
	positionedById: Map<string, PositionedNode>,
	nodeToMapRoot: Map<string, MindmapNode>,
	autoPositions: Map<string, { x: number; y: number }>,
	freeLayout: boolean,
) {
	const stale = new Set<string>();
	connections.forEach((path) => {
		const suffix = RAIL_SUFFIXES.find((candidate) => path.id.endsWith(candidate));
		if (!suffix) return;
		const owner = positionedById.get(path.id.slice(0, -suffix.length));
		if (!owner) return;
		const ownerMapRoot = nodeToMapRoot.get(owner.id);
		const ownerMapRootPosition = ownerMapRoot ? positionedById.get(ownerMapRoot.id) : undefined;
		const displaced = (node: PositionedNode) => node.node.floating
			|| (freeLayout && positionChanged(node, autoPositions, ownerMapRootPosition));
		const railChildren = (owner.node.children ?? [])
			.map((child) => positionedById.get(child.id))
			.filter((child): child is PositionedNode => !!child);
		if (displaced(owner) || railChildren.some(displaced)) stale.add(path.id);
	});
	return stale;
}
