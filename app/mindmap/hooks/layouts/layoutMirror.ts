import type { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import type { ConnectionPath, PositionedNode } from "./layoutHelpers";
import { resolveMapLayout } from "./mapLayoutConfig";

type Point = { x: number; y: number };
type MirrorAxis = "x" | "y" | "xy";

const COMMAND_ARITY: Record<string, number> = {
	M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7,
};

function round(value: number) {
	return Math.round(value * 1000) / 1000;
}

function mirrorPoint(point: Point, pivot: Point, axis: MirrorAxis): Point {
	const flipX = axis === "x" || axis === "xy";
	const flipY = axis === "y" || axis === "xy";
	return {
		x: flipX ? pivot.x * 2 - point.x : point.x,
		y: flipY ? pivot.y * 2 - point.y : point.y,
	};
}

/** A single-axis mirror flips path handedness (arc rotation sign, sweep flag); a
 *  combined "xy" mirror is a 180° point reflection, which preserves handedness. */
function axisFlipCount(axis: MirrorAxis) {
	return axis === "xy" ? 0 : 1;
}

function transformPath(d: string, pivot: Point, axis: MirrorAxis): string {
	const segments = d.match(/[A-Za-z][^A-Za-z]*/g) ?? [];
	let current = { x: 0, y: 0 };
	let subpathStart = { x: 0, y: 0 };
	const output: string[] = [];
	const format = (point: Point) => `${round(point.x)} ${round(point.y)}`;

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
				output.push(`L ${format(mirrorPoint(point, pivot, axis))}`);
				current = point;
				continue;
			}
			if (command === "A") {
				const endpoint = absolutePoint(values[5], values[6]);
				const mirrored = mirrorPoint(endpoint, pivot, axis);
				const flips = axisFlipCount(axis);
				const rotation = flips ? -values[2] : values[2];
				const sweep = flips ? (values[4] ? 0 : 1) : values[4];
				output.push(`A ${round(values[0])} ${round(values[1])} ${round(rotation)} ${values[3]} ${sweep} ${format(mirrored)}`);
				current = endpoint;
				continue;
			}
			const points: Point[] = [];
			for (let index = 0; index < arity / 2; index += 1) {
				points.push(absolutePoint(values[index * 2], values[index * 2 + 1]));
			}
			const renderedCommand = command === "M" && output.length > 0 ? "L" : command;
			output.push(`${renderedCommand} ${points.map((point) => format(mirrorPoint(point, pivot, axis))).join(" ")}`);
			current = points[points.length - 1];
			if (command === "M") subpathStart = current;
		}
	}
	return output.join(" ");
}

function mirrorAxis(mapRoot: MindmapNode, defaultLayoutType?: string): MirrorAxis | null {
	const layoutType = (mapRoot.style?.layoutType ?? defaultLayoutType ?? "logical-right") as NonNullable<MindmapNode["style"]>["layoutType"];
	if (!layoutType || !mapRoot.style?.layoutDirection) return null;
	const resolved = resolveMapLayout(layoutType, mapRoot.style);
	if (resolved.family === "hierarchy" && resolved.direction === "up") return "y";
	if (resolved.family === "timeline" && resolved.direction === "left") return "x";
	if (resolved.family === "timeline" && resolved.direction === "up") return "y";
	if (resolved.family === "catalog") {
		// Catalog direction packs two independent toggles (rail side, growth
		// direction) into the shared 4-value direction id: "left" flips the rail
		// only, "up" flips growth only, "down" is reused to mean both at once.
		if (resolved.direction === "left") return "x";
		if (resolved.direction === "up") return "y";
		if (resolved.direction === "down") return "xy";
	}
	return null;
}

export function normalizeCanonicalCustomPosition(
	position: { x: number; y: number; width: number },
	mapRoot: MindmapNode,
	pivot: Point,
	defaultLayoutType?: string,
) {
	const axis = mirrorAxis(mapRoot, defaultLayoutType);
	if (!axis) return { x: position.x, y: position.y };
	const center = mirrorPoint({ x: position.x + position.width / 2, y: position.y }, pivot, axis);
	return { x: center.x - position.width / 2, y: center.y };
}

export function applyCanonicalLayoutMirrors(
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	nodeToMapRoot: Map<string, MindmapNode>,
	defaultLayoutType?: string,
) {
	const positionedById = new Map(positioned.map((node) => [node.id, node]));
	const roots = Array.from(new Map(
		Array.from(nodeToMapRoot.values()).map((root) => [root.id, root]),
	).values());

	for (const mapRoot of roots) {
		// A free-form map has no layout of its own to mirror; inheriting the
		// document's would flip a hand-arranged canvas behind the user's back.
		if (mapRoot.style?.freeForm) continue;
		const axis = mirrorAxis(mapRoot, defaultLayoutType);
		const rootNode = positionedById.get(mapRoot.id);
		if (!axis || !rootNode) continue;
		const pivot = { x: rootNode.x + rootNode.width / 2, y: rootNode.y };
		const mapNodes = positioned.filter((node) => nodeToMapRoot.get(node.id)?.id === mapRoot.id);
		const mapNodeIds = new Set(mapNodes.map((node) => node.id));
		for (const node of mapNodes) {
			const center = mirrorPoint({ x: node.x + node.width / 2, y: node.y }, pivot, axis);
			node.x = center.x - node.width / 2;
			node.y = center.y;
		}
		for (const path of connections) {
			if (Array.from(mapNodeIds).some((id) => path.id.startsWith(`${id}-`))) {
				path.d = transformPath(path.d, pivot, axis);
			}
		}
	}
}
