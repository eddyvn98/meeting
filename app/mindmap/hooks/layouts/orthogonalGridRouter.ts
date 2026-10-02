import type { PositionedNode } from "./layoutHelpers";

export type GridRoutePoint = { x: number; y: number };

const CLEARANCE = 12;
const DIRECTIONS = [
	[-1, 0],
	[1, 0],
	[0, -1],
	[0, 1],
] as const;

type QueueItem = { index: number; direction: number; cost: number; key: string };

function obstacleBounds(node: PositionedNode, clearance: number) {
	return {
		left: node.x - clearance,
		right: node.x + node.width + clearance,
		top: node.y - node.height / 2 - clearance,
		bottom: node.y + node.height / 2 + clearance,
	};
}

function pointBlocked(point: GridRoutePoint, obstacles: PositionedNode[], clearance: number) {
	return obstacles.some((node) => {
		const bounds = obstacleBounds(node, clearance);
		return point.x > bounds.left && point.x < bounds.right
			&& point.y > bounds.top && point.y < bounds.bottom;
	});
}

export function isOrthogonalRouteClear(points: GridRoutePoint[], obstacles: PositionedNode[], clearance = CLEARANCE) {
	for (let index = 1; index < points.length; index += 1) {
		const a = points[index - 1];
		const b = points[index];
		if (a.x !== b.x && a.y !== b.y) return false;
		if (obstacles.some((node) => {
			const bounds = obstacleBounds(node, clearance);
			if (a.x === b.x) {
				return a.x > bounds.left && a.x < bounds.right
					&& Math.max(a.y, b.y) > bounds.top
					&& Math.min(a.y, b.y) < bounds.bottom;
			}
			return a.y > bounds.top && a.y < bounds.bottom
				&& Math.max(a.x, b.x) > bounds.left
				&& Math.min(a.x, b.x) < bounds.right;
		})) return false;
	}
	return true;
}

function segmentClear(a: GridRoutePoint, b: GridRoutePoint, obstacles: PositionedNode[], clearance: number) {
	if (a.x !== b.x && a.y !== b.y) return false;
	return isOrthogonalRouteClear([a, b], obstacles, clearance);
}

function uniqueSorted(values: number[]) {
	return [...new Set(values)].sort((a, b) => a - b);
}

function push(queue: QueueItem[], item: QueueItem) {
	queue.push(item);
	let index = queue.length - 1;
	while (index > 0) {
		const parent = Math.floor((index - 1) / 2);
		if (queue[parent].cost <= queue[index].cost) break;
		[queue[parent], queue[index]] = [queue[index], queue[parent]];
		index = parent;
	}
}

function pop(queue: QueueItem[]) {
	const first = queue[0];
	const last = queue.pop();
	if (queue.length && last) {
		queue[0] = last;
		let index = 0;
		while (true) {
			const left = index * 2 + 1;
			const right = left + 1;
			let smallest = index;
			if (left < queue.length && queue[left].cost < queue[smallest].cost) smallest = left;
			if (right < queue.length && queue[right].cost < queue[smallest].cost) smallest = right;
			if (smallest === index) break;
			[queue[index], queue[smallest]] = [queue[smallest], queue[index]];
			index = smallest;
		}
	}
	return first;
}

function pointAt(index: number, width: number, xs: number[], ys: number[]): GridRoutePoint {
	return { x: xs[index % width], y: ys[Math.floor(index / width)] };
}

/** Finds a shortest deterministic orthogonal path through obstacle boundary corridors. */
export function findGridOrthogonalRoute(
	start: GridRoutePoint,
	end: GridRoutePoint,
	obstacles: PositionedNode[],
	clearance = CLEARANCE,
) {
	if (start.x === end.x && start.y === end.y) return [start];
	const xs = uniqueSorted([
		start.x,
		end.x,
		...obstacles.flatMap((node) => {
			const bounds = obstacleBounds(node, clearance);
			return [bounds.left, bounds.right];
		}),
	]);
	const ys = uniqueSorted([
		start.y,
		end.y,
		...obstacles.flatMap((node) => {
			const bounds = obstacleBounds(node, clearance);
			return [bounds.top, bounds.bottom];
		}),
	]);
	const width = xs.length;
	const height = ys.length;
	const startIndex = ys.indexOf(start.y) * width + xs.indexOf(start.x);
	const endIndex = ys.indexOf(end.y) * width + xs.indexOf(end.x);
	const blocked = Array.from({ length: width * height }, (_, index) => pointBlocked(pointAt(index, width, xs, ys), obstacles, clearance));
	if (startIndex < 0 || endIndex < 0 || blocked[startIndex] || blocked[endIndex]) return null;

	const queue: QueueItem[] = [];
	const distances = new Map<string, number>();
	const previous = new Map<string, string>();
	const startKey = `${startIndex}:4`;
	distances.set(startKey, 0);
	push(queue, { index: startIndex, direction: 4, cost: 0, key: startKey });

	while (queue.length) {
		const current = pop(queue)!;
		if (current.cost !== distances.get(current.key)) continue;
		if (current.index === endIndex) {
			const route: GridRoutePoint[] = [];
			let key: string | undefined = current.key;
			while (key) {
				const index = Number(key.slice(0, key.indexOf(":")));
				route.push(pointAt(index, width, xs, ys));
				key = previous.get(key);
			}
			return route.reverse();
		}
		const row = Math.floor(current.index / width);
		const column = current.index % width;
		for (let direction = 0; direction < DIRECTIONS.length; direction += 1) {
			const nextColumn = column + DIRECTIONS[direction][0];
			const nextRow = row + DIRECTIONS[direction][1];
			if (nextColumn < 0 || nextColumn >= width || nextRow < 0 || nextRow >= height) continue;
			const nextIndex = nextRow * width + nextColumn;
			if (blocked[nextIndex]) continue;
			const nextPoint = pointAt(nextIndex, width, xs, ys);
			if (!segmentClear(pointAt(current.index, width, xs, ys), nextPoint, obstacles, clearance)) continue;
			const turnCost = current.direction !== 4 && current.direction !== direction ? 8 : 0;
			const nextCost = current.cost
				+ Math.abs(nextPoint.x - xs[column])
				+ Math.abs(nextPoint.y - ys[row])
				+ turnCost;
			const nextKey = `${nextIndex}:${direction}`;
			if (nextCost >= (distances.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
			distances.set(nextKey, nextCost);
			previous.set(nextKey, current.key);
			push(queue, { index: nextIndex, direction, cost: nextCost, key: nextKey });
		}
	}
	return null;
}
