import type { PositionedNode } from "@/app/mindmap/hooks/usePageLayout";
import { replacePathEndpoints } from "@/app/mindmap/hooks/layouts/layoutRotation";
import { getPathPoints } from "./svgPathHelpers";

type Point = { x: number; y: number };

function rotatePoint(point: Point, node: PositionedNode): Point {
	const rotation = node.node.style?.rotation ?? 0;
	if (!rotation) return point;
	const radians = rotation * Math.PI / 180;
	const centerX = node.x + node.width / 2;
	const centerY = node.y;
	const dx = point.x - centerX;
	const dy = point.y - centerY;
	return {
		x: centerX + dx * Math.cos(radians) - dy * Math.sin(radians),
		y: centerY + dx * Math.sin(radians) + dy * Math.cos(radians),
	};
}

export function projectConnectionPathForRotation(
	d: string,
	parentNode: PositionedNode | undefined,
	childNode: PositionedNode | undefined,
) {
	if (!parentNode || !childNode) return d;
	const parentTransformId = parentNode.node.style?.groupTransform?.id;
	if (parentTransformId && parentTransformId === childNode.node.style?.groupTransform?.id) return d;
	// Endpoint projection is only needed when a node is actually rotated. For
	// the normal zero-rotation path, rewriting the cubic here destroys layout
	// geometry such as a shared root trunk and changes an otherwise stable wire.
	const parentRotation = parentNode.node.style?.rotation ?? 0;
	const childRotation = childNode.node.style?.rotation ?? 0;
	if (!parentRotation && !childRotation) return d;
	const points = getPathPoints(d);
	if (points.length < 2) return d;
	const start = points[0];
	const end = points[points.length - 1];
	return replacePathEndpoints(d, rotatePoint(start, parentNode), rotatePoint(end, childNode));
}
