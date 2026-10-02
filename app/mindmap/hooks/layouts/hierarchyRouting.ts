import type { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import { layoutRotationAngle } from "./layoutOrientation";
import type { AnchorSide } from "./obstacleRouter";
import type { PositionedNode } from "./layoutHelpers";

type Point = { x: number; y: number };

const BASE_DIRECTIONS: Partial<Record<string, Point>> = {
	"logical-right": { x: 1, y: 0 },
	"logical-left": { x: -1, y: 0 },
	"org-chart": { x: 0, y: 1 },
	catalog: { x: 0, y: 1 },
	timeline: { x: 1, y: 0 },
	"vertical-timeline": { x: 0, y: 1 },
	flowchart: { x: 1, y: 0 },
	swimlane: { x: 0, y: 1 },
};

function center(node: PositionedNode): Point {
	return { x: node.x + node.width / 2, y: node.y };
}

function oppositeSide(side: AnchorSide): AnchorSide {
	if (side === "left") return "right";
	if (side === "right") return "left";
	if (side === "top") return "bottom";
	return "top";
}

function vectorSide(vector: Point): AnchorSide {
	if (Math.abs(vector.x) >= Math.abs(vector.y)) return vector.x < 0 ? "left" : "right";
	return vector.y < 0 ? "top" : "bottom";
}

export function hierarchySides(
	mapRoot: MindmapNode | undefined,
	layoutType: string | undefined,
	parent: PositionedNode,
	child: PositionedNode,
): [AnchorSide, AnchorSide] {
	if (layoutType === "mindmap-vertical") {
		const side: AnchorSide = child.y < parent.y ? "top" : "bottom";
		return [side, oppositeSide(side)];
	}
	if (layoutType === "mindmap") {
		// Both-side Left–Right branches stay horizontal even when subtree packing
		// places a branch well above or below its parent.
		const side: AnchorSide = child.x + child.width / 2 < parent.x + parent.width / 2
			? "left"
			: "right";
		return [side, oppositeSide(side)];
	}
	const base = layoutType ? BASE_DIRECTIONS[layoutType] : undefined;
	if (!base) {
		const from = center(parent);
		const to = center(child);
		const side = vectorSide({ x: to.x - from.x, y: to.y - from.y });
		return [side, oppositeSide(side)];
	}
	const angle = (mapRoot?.style?.layoutDirection
		? 0
		: layoutRotationAngle(layoutType, mapRoot?.style?.layoutAngle)) * Math.PI / 180;
	const vector = {
		x: base.x * Math.cos(angle) - base.y * Math.sin(angle),
		y: base.x * Math.sin(angle) + base.y * Math.cos(angle),
	};
	const side = vectorSide(vector);
	return [side, oppositeSide(side)];
}
