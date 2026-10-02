export interface CanvasRect {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export interface PlacementRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export function rectsOverlap(a: CanvasRect, b: CanvasRect, gap = 0) {
	return a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;
}

export function rectFromPlacement(rect: PlacementRect, padding = 0): CanvasRect {
	return {
		left: rect.x - padding,
		right: rect.x + rect.width + padding,
		top: rect.y - padding,
		bottom: rect.y + rect.height + padding,
	};
}

function overlapArea(a: CanvasRect, b: CanvasRect, gap: number) {
	const width = Math.max(0, Math.min(a.right, b.right + gap) - Math.max(a.left, b.left - gap));
	const height = Math.max(0, Math.min(a.bottom, b.bottom + gap) - Math.max(a.top, b.top - gap));
	return width * height;
}

/** Deterministic nearest-free placement. AI may suggest a position, but the
 * canvas owns the final coordinates so generated objects do not stack. */
export function placeRectAvoidingOverlap(preferred: PlacementRect, occupied: CanvasRect[], gap = 24): { x: number; y: number } {
	if (!occupied.some((rect) => rectsOverlap(rectFromPlacement(preferred), rect, gap))) {
		return { x: preferred.x, y: preferred.y };
	}

	const candidates: Array<{ x: number; y: number }> = [];
	for (const rect of occupied) {
		candidates.push(
			{ x: rect.right + gap, y: preferred.y },
			{ x: rect.left - preferred.width - gap, y: preferred.y },
			{ x: preferred.x, y: rect.bottom + gap },
			{ x: preferred.x, y: rect.top - preferred.height - gap },
		);
	}
	for (let ring = 1; ring <= 8; ring += 1) {
		const distance = ring * (preferred.width + gap);
		candidates.push(
			{ x: preferred.x + distance, y: preferred.y },
			{ x: preferred.x - distance, y: preferred.y },
			{ x: preferred.x, y: preferred.y + distance },
			{ x: preferred.x, y: preferred.y - distance },
		);
	}

	const free = candidates.find((candidate) => {
		const rect = rectFromPlacement({ ...preferred, ...candidate });
		return !occupied.some((other) => rectsOverlap(rect, other, gap));
	});
	if (free) return free;

	return candidates
		.map((candidate) => ({ candidate, score: occupied.reduce((sum, rect) => sum + overlapArea(rectFromPlacement({ ...preferred, ...candidate }), rect, gap), 0) }))
		.sort((a, b) => a.score - b.score)[0]?.candidate || { x: preferred.x, y: preferred.y };
}

export function rectFromStroke(points: Array<{ x: number; y: number }>, padding = 0): CanvasRect | null {
	if (points.length === 0) return null;
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	return { left: Math.min(...xs) - padding, right: Math.max(...xs) + padding, top: Math.min(...ys) - padding, bottom: Math.max(...ys) + padding };
}
