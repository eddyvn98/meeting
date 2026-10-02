export interface Point { x: number; y: number }

// Helper: Sample Cubic Bezier curve into points
export function sampleBezier(sx: number, sy: number, cp1x: number, cp1y: number, cp2x: number, cp2y: number, ex: number, ey: number, numSamples = 10): Point[] {
	const points: Point[] = [];
	for (let i = 0; i <= numSamples; i++) {
		const t = i / numSamples;
		const mt = 1 - t;
		const x = mt*mt*mt * sx + 3 * mt*mt*t * cp1x + 3 * mt*t*t * cp2x + t*t*t * ex;
		const y = mt*mt*mt * sy + 3 * mt*mt*t * cp1y + 3 * mt*t*t * cp2y + t*t*t * ey;
		points.push({ x, y });
	}
	return points;
}

// Helper: Parse SVG path string (like command M, L, H, V, C) into points
export function getPathPoints(d: string): Point[] {
	const points: Point[] = [];
	const tokens = d.split(/\s+|,/).filter(Boolean);
	let i = 0;
	let currX = 0;
	let currY = 0;

	while (i < tokens.length) {
		const cmd = tokens[i];
		if (cmd === "M" || cmd === "L") {
			const x = parseFloat(tokens[i+1]);
			const y = parseFloat(tokens[i+2]);
			points.push({ x, y });
			currX = x;
			currY = y;
			i += 3;
		} else if (cmd === "H") {
			const x = parseFloat(tokens[i+1]);
			points.push({ x, y: currY });
			currX = x;
			i += 2;
		} else if (cmd === "V") {
			const y = parseFloat(tokens[i+1]);
			points.push({ x: currX, y });
			currY = y;
			i += 2;
		} else if (cmd === "C") {
			const cp1x = parseFloat(tokens[i+1]);
			const cp1y = parseFloat(tokens[i+2]);
			const cp2x = parseFloat(tokens[i+3]);
			const cp2y = parseFloat(tokens[i+4]);
			const ex = parseFloat(tokens[i+5]);
			const ey = parseFloat(tokens[i+6]);

			const sampled = sampleBezier(currX, currY, cp1x, cp1y, cp2x, cp2y, ex, ey);
			points.push(...sampled.slice(1));

			currX = ex;
			currY = ey;
			i += 7;
		} else {
			// Fallback: parse raw number coordinates
			const val1 = parseFloat(cmd);
			if (!isNaN(val1) && i + 1 < tokens.length) {
				const val2 = parseFloat(tokens[i+1]);
				if (!isNaN(val2)) {
					points.push({ x: val1, y: val2 });
					currX = val1;
					currY = val2;
					i += 2;
					continue;
				}
			}
			i++;
		}
	}
	return points;
}

/** Convert any malformed connector vertices into an axis-aligned polyline. */
export function normalizeOrthogonalPathPoints(points: Point[]): Point[] {
	if (points.length < 2) return points.map((point) => ({ ...point }));
	const normalized: Point[] = [{ ...points[0] }];
	for (const target of points.slice(1)) {
		const previous = normalized[normalized.length - 1];
		if (previous.x === target.x && previous.y === target.y) continue;
		if (previous.x !== target.x && previous.y !== target.y) {
			const beforePrevious = normalized[normalized.length - 2];
			const previousIsVertical = beforePrevious && beforePrevious.x === previous.x;
			normalized.push(previousIsVertical
				? { x: previous.x, y: target.y }
				: { x: target.x, y: previous.y });
		}
		normalized.push({ ...target });
		while (normalized.length >= 3) {
			const end = normalized.length - 1;
			const a = normalized[end - 2];
			const b = normalized[end - 1];
			const c = normalized[end];
			if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) {
				normalized.splice(end - 1, 1);
			} else {
				break;
			}
		}
	}
	return normalized;
}

// Helper: Line intersection algorithm
export function getIntersection(p1: Point, p2: Point, q1: Point, q2: Point): Point | null {
	const det = (p2.x - p1.x) * (q2.y - q1.y) - (q2.x - q1.x) * (p2.y - p1.y);
	if (det === 0) return null;

	const t = ((q1.x - p1.x) * (q2.y - q1.y) - (q2.x - q1.x) * (q1.y - p1.y)) / det;
	const u = ((q1.x - p1.x) * (p2.y - p1.y) - (p2.x - p1.x) * (q1.y - p1.y)) / det;

	if (t > 0.08 && t < 0.92 && u > 0.08 && u < 0.92) {
		return {
			x: p1.x + t * (p2.x - p1.x),
			y: p1.y + t * (p2.y - p1.y)
		};
	}
	return null;
}

// Helper: Build path string with Line Jumps
export function buildPathWithJumps(
	d: string,
	pathId: string,
	allPaths: { id: string; d: string }[],
	precomputedPointsById?: Map<string, Point[]>
): string {
	const points = getPathPoints(d);
	if (points.length < 2) return d;

	let newD = `M ${points[0].x} ${points[0].y}`;
	const r = 5; // jump radius

	// Get other segments to check intersection
	const otherSegments: { p1: Point; p2: Point }[] = [];
	allPaths.forEach(otherPath => {
		if (otherPath.id === pathId) return;
		const otherPoints = precomputedPointsById?.get(otherPath.id) ?? getPathPoints(otherPath.d);
		for (let k = 0; k < otherPoints.length - 1; k++) {
			otherSegments.push({ p1: otherPoints[k], p2: otherPoints[k+1] });
		}
	});

	for (let j = 0; j < points.length - 1; j++) {
		const p1 = points[j];
		const p2 = points[j+1];

		const intersections: { pt: Point; dist: number }[] = [];
		otherSegments.forEach(seg => {
			const intersect = getIntersection(p1, p2, seg.p1, seg.p2);
			if (intersect) {
				const dx = intersect.x - p1.x;
				const dy = intersect.y - p1.y;
				const dist = Math.sqrt(dx*dx + dy*dy);
				intersections.push({ pt: intersect, dist });
			}
		});

		intersections.sort((a, b) => a.dist - b.dist);

		if (intersections.length === 0) {
			newD += ` L ${p2.x} ${p2.y}`;
		} else {
			const dx = p2.x - p1.x;
			const dy = p2.y - p1.y;
			const segLen = Math.sqrt(dx*dx + dy*dy);
			const ux = dx / segLen;
			const uy = dy / segLen;

			intersections.forEach(inter => {
				const ax = inter.pt.x - r * ux;
				const ay = inter.pt.y - r * uy;
				const bx = inter.pt.x + r * ux;
				const by = inter.pt.y + r * uy;

				newD += ` L ${ax} ${ay} A ${r} ${r} 0 0 1 ${bx} ${by}`;
			});
			newD += ` L ${p2.x} ${p2.y}`;
		}
	}
	return newD;
}

// Helper: Get middle position and tangent angle for Line Label
export function getPathMiddleProps(d: string): { x: number; y: number; angle: number } {
	const points = getPathPoints(d);
	if (points.length < 2) return { x: 0, y: 0, angle: 0 };

	let totalLen = 0;
	const lens: number[] = [];
	for (let k = 0; k < points.length - 1; k++) {
		const dx = points[k+1].x - points[k].x;
		const dy = points[k+1].y - points[k].y;
		const len = Math.sqrt(dx*dx + dy*dy);
		lens.push(len);
		totalLen += len;
	}

	const midLen = totalLen / 2;
	let currLen = 0;
	for (let k = 0; k < points.length - 1; k++) {
		if (currLen + lens[k] >= midLen) {
			const ratio = (midLen - currLen) / lens[k];
			const p1 = points[k];
			const p2 = points[k+1];
			const mx = p1.x + ratio * (p2.x - p1.x);
			const my = p1.y + ratio * (p2.y - p1.y);

			let angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
			if (angle > 90) angle -= 180;
			if (angle < -90) angle += 180;

			return { x: mx, y: my, angle };
		}
		currLen += lens[k];
	}

	const p1 = points[0];
	const p2 = points[points.length - 1];
	return {
		x: (p1.x + p2.x) / 2,
		y: (p1.y + p2.y) / 2,
		angle: Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI
	};
}
