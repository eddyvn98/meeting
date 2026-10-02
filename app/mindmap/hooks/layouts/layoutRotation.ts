import type { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import { parsePathId, type ConnectionPath, type PositionedNode, X_GAP, Y_GAP } from "./layoutHelpers";
import { layoutRotationAngle } from "./layoutOrientation";
import { mapLayoutFamily } from "./mapLayoutConfig";
import type { LayoutType } from "../usePageLayout";

type Point = { x: number; y: number };

const COMMAND_ARITY: Record<string, number> = {
	M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7,
};

export function normalizeLayoutAngle(angle?: number): number {
	if (!Number.isFinite(angle)) return 0;
	const normalized = ((angle! % 360) + 360) % 360;
	return Math.abs(normalized) < 0.001 || Math.abs(normalized - 360) < 0.001
		? 0
		: normalized;
}

function rotatePoint(point: Point, pivot: Point, angle: number): Point {
	const radians = angle * Math.PI / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const dx = point.x - pivot.x;
	const dy = point.y - pivot.y;
	return {
		x: pivot.x + dx * cos - dy * sin,
		y: pivot.y + dx * sin + dy * cos,
	};
}

function round(value: number) {
	return Math.round(value * 1000) / 1000;
}

function formatPoint(point: Point) {
	return `${round(point.x)} ${round(point.y)}`;
}

function transformPathD(d: string, pivot: Point, angle: number): string {
	const segments = d.match(/[A-Za-z][^A-Za-z]*/g) ?? [];
	let current = { x: 0, y: 0 };
	let subpathStart = { x: 0, y: 0 };
	const output: string[] = [];

	for (const segment of segments) {
		const rawCommand = segment[0];
		const command = rawCommand.toUpperCase();
		const relative = rawCommand !== command;
		const numbers = segment.slice(1).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
		if (command === "Z") {
			output.push("Z");
			current = subpathStart;
			continue;
		}

		const arity = COMMAND_ARITY[command];
		if (!arity) {
			output.push(segment);
			continue;
		}

		for (let offset = 0; offset + arity <= numbers.length; offset += arity) {
			const values = numbers.slice(offset, offset + arity);
			const absolutePoint = (x: number, y: number): Point => ({
				x: relative ? current.x + x : x,
				y: relative ? current.y + y : y,
			});

			if (command === "H" || command === "V") {
				const point = command === "H"
					? absolutePoint(values[0], relative ? 0 : current.y)
					: absolutePoint(relative ? 0 : current.x, values[0]);
				output.push(`L ${formatPoint(rotatePoint(point, pivot, angle))}`);
				current = point;
				continue;
			}

			if (command === "A") {
				const endpoint = absolutePoint(values[5], values[6]);
				const rotated = rotatePoint(endpoint, pivot, angle);
				output.push(`A ${round(values[0])} ${round(values[1])} ${round(values[2] + angle)} ${values[3]} ${values[4]} ${formatPoint(rotated)}`);
				current = endpoint;
				continue;
			}

			const pointCount = arity / 2;
			const points: Point[] = [];
			for (let index = 0; index < pointCount; index += 1) {
				points.push(absolutePoint(values[index * 2], values[index * 2 + 1]));
			}
			const renderedCommand = command === "M" && output.length > 0 ? "L" : command;
			output.push(`${renderedCommand} ${points.map((point) => formatPoint(rotatePoint(point, pivot, angle))).join(" ")}`);
			current = points[points.length - 1];
			if (command === "M") subpathStart = current;
		}
	}
	return output.join(" ");
}

function rectangleEdgePoint(node: PositionedNode, toward: Point): Point {
	const center = { x: node.x + node.width / 2, y: node.y };
	const dx = toward.x - center.x;
	const dy = toward.y - center.y;
	if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return center;
	const scale = 1 / Math.max(
		Math.abs(dx) / Math.max(node.width / 2, 0.001),
		Math.abs(dy) / Math.max(node.height / 2, 0.001)
	);
	return { x: center.x + dx * scale, y: center.y + dy * scale };
}

export function replacePathEndpoints(d: string, start: Point | null, end: Point | null): string {
	const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
	const numericIndexes = tokens
		.map((token, index) => (/^[A-Za-z]$/.test(token) ? -1 : index))
		.filter((index) => index >= 0);
	if (numericIndexes.length < 2) return d;

	const hasCubicBezier = tokens.some((t) => t.toUpperCase() === "C");

	if (start) {
		const moveIndex = tokens.findIndex((token) => token.toUpperCase() === "M");
		if (moveIndex >= 0 && moveIndex + 2 < tokens.length) {
			tokens[moveIndex + 1] = String(round(start.x));
			tokens[moveIndex + 2] = String(round(start.y));
		}
	}
	if (end) {
		const commandIndex = tokens.reduce((last, token, index) => (
			/^[A-Za-z]$/.test(token) ? index : last
		), -1);
		const command = tokens[commandIndex]?.toUpperCase();
		const values = command === "C" ? 6
			: command === "S" || command === "Q" ? 4
			: command === "A" ? 7
			: command === "L" || command === "M" ? 2
			: command === "H" || command === "V" ? 1
			: 0;
		if (commandIndex < 0 || values === 0 || commandIndex + values >= tokens.length) return d;
		if (command === "H" || command === "V") {
			tokens.splice(commandIndex, values + 1, "L", String(round(end.x)), String(round(end.y)));
		} else {
			tokens[commandIndex + values - 1] = String(round(end.x));
			tokens[commandIndex + values] = String(round(end.y));
		}
	}

	// After snapping both endpoints, regenerate cubic bezier control points to
	// prevent Z-shapes that arise when rotation changed the path direction.
	// Control points are rebuilt from scratch using the actual start→end vector.
	if (hasCubicBezier && start && end && numericIndexes.length >= 8) {
		const adx = Math.abs(end.x - start.x);
		const ady = Math.abs(end.y - start.y);
		let cx1: number, cy1: number, cx2: number, cy2: number;
		if (adx >= ady) {
			// Cap offset so control points stay within the start→end corridor
			const off = Math.min(X_GAP / 2, adx / 2);
			cx1 = end.x < start.x ? start.x - off : start.x + off;
			cy1 = start.y;
			cx2 = end.x < start.x ? end.x + off : end.x - off;
			cy2 = end.y;
		} else {
			const off = Math.min(Y_GAP * 2, ady / 2);
			cx1 = start.x;
			cy1 = end.y < start.y ? start.y - off : start.y + off;
			cx2 = end.x;
			cy2 = end.y < start.y ? end.y + off : end.y - off;
		}
		const cIdx = tokens.findIndex((t) => t.toUpperCase() === "C");
		if (cIdx >= 0 && cIdx + 4 < tokens.length) {
			tokens[cIdx + 1] = String(round(cx1));
			tokens[cIdx + 2] = String(round(cy1));
			tokens[cIdx + 3] = String(round(cx2));
			tokens[cIdx + 4] = String(round(cy2));
		}
	}

	return tokens.join(" ");
}

function pathEndPoint(d: string): Point | null {
	const values = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
	if (values.length < 2) return null;
	return { x: values[values.length - 2], y: values[values.length - 1] };
}

function collectMapNodes(
	positioned: PositionedNode[],
	nodeToMapRoot: Map<string, MindmapNode>,
	mapRoot: MindmapNode
) {
	return positioned.filter((node) => nodeToMapRoot.get(node.id)?.id === mapRoot.id);
}

export function applyMapLayoutRotations(
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	nodeToMapRoot: Map<string, MindmapNode>,
	defaultLayoutType?: string
) {
	const positionedById = new Map(positioned.map((node) => [node.id, node]));
	const allNodeIds = new Set(positionedById.keys());
	const mapRoots = Array.from(new Map(
		Array.from(nodeToMapRoot.values()).map((root) => [root.id, root])
	).values());

	for (const mapRoot of mapRoots) {
		// Same reason as the mirror pass: a hand-arranged map must not inherit the
		// document layout's rotation.
		if (mapRoot.style?.freeForm) continue;
		const layoutType = mapRoot.style?.layoutType ?? defaultLayoutType;
		const family = layoutType ? mapLayoutFamily(layoutType as LayoutType) : undefined;
		if (
			mapRoot.style?.layoutDirection
			|| !layoutType
			|| (family !== "hierarchy" && family !== "timeline")
		) continue;
		const angle = layoutRotationAngle(layoutType, mapRoot.style?.layoutAngle);
		if (angle === 0) continue;
		const rootPosition = positionedById.get(mapRoot.id);
		if (!rootPosition) continue;
		const pivot = {
			x: rootPosition.x + rootPosition.width / 2,
			y: rootPosition.y,
		};
		const mapNodes = collectMapNodes(positioned, nodeToMapRoot, mapRoot);
		const mapNodeIds = new Set(mapNodes.map((node) => node.id));

		for (const node of mapNodes) {
			const center = rotatePoint(
				{ x: node.x + node.width / 2, y: node.y },
				pivot,
				angle
			);
			node.x = center.x - node.width / 2;
			node.y = center.y;
		}

		for (const path of connections) {
			const belongsToMap = Array.from(mapNodeIds).some((id) => path.id.startsWith(`${id}-`));
			if (!belongsToMap) continue;
			path.d = transformPathD(path.d, pivot, angle);
			if (path.id === `${mapRoot.id}-spine-backbone`) {
				const end = pathEndPoint(path.d);
				if (end) {
					path.d = replacePathEndpoints(
						path.d,
						rectangleEdgePoint(rootPosition, end),
						null
					);
				}
				continue;
			}

			const parsed = parsePathId(path.id, positioned, allNodeIds);
			if (!parsed || !mapNodeIds.has(parsed.parentId) || !mapNodeIds.has(parsed.childId)) continue;
			const parent = positionedById.get(parsed.parentId);
			const child = positionedById.get(parsed.childId);
			if (!parent || !child) continue;
			const parentCenter = { x: parent.x + parent.width / 2, y: parent.y };
			const childCenter = { x: child.x + child.width / 2, y: child.y };
			const isFishboneSpineAnchor =
				(mapRoot.style?.layoutType ?? defaultLayoutType) === "fishbone"
				&& path.id.endsWith("-entry");
			const snapStart = isFishboneSpineAnchor
				? null
				: rectangleEdgePoint(parent, childCenter);
			const snapEnd = rectangleEdgePoint(child, parentCenter);
			path.d = replacePathEndpoints(path.d, snapStart, snapEnd);
		}
	}
}

function subtreeContains(node: MindmapNode, nodeId: string): boolean {
	return node.id === nodeId || node.children.some((child) => subtreeContains(child, nodeId));
}

export function normalizeDraggedPositionsForRotation(
	tree: MindmapNode,
	positionedById: Map<string, PositionedNode>,
	positions: Record<string, Point>,
	delta: { dx: number; dy: number },
	sourceId: string
): { positions: Record<string, Point>; dx: number; dy: number } {
	const roots = tree.id === "virtual-root" ? tree.children : [tree];
	const mapRoot = roots.find((root) => subtreeContains(root, sourceId));
	const layoutType = mapRoot?.style?.layoutType;
	const family = layoutType ? mapLayoutFamily(layoutType as LayoutType) : undefined;
	const angle = family === "hierarchy" || family === "timeline"
		? layoutRotationAngle(layoutType, mapRoot?.style?.layoutAngle)
		: 0;
	const rootPosition = mapRoot ? positionedById.get(mapRoot.id) : undefined;
	if (!mapRoot || !rootPosition || angle === 0) return { positions, ...delta };

	const pivot = { x: rootPosition.x + rootPosition.width / 2, y: rootPosition.y };
	const normalized: Record<string, Point> = {};
	for (const [nodeId, position] of Object.entries(positions)) {
		const node = positionedById.get(nodeId);
		if (!node) continue;
		const finalCenter = {
			x: position.x + node.width / 2 + delta.dx,
			y: position.y + delta.dy,
		};
		const localCenter = rotatePoint(finalCenter, pivot, -angle);
		normalized[nodeId] = {
			x: localCenter.x - node.width / 2,
			y: localCenter.y,
		};
	}
	return { positions: normalized, dx: 0, dy: 0 };
}
