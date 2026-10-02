/**
 * Pure geometry helpers for the floating "Ask AI" chat bubble
 * (AskChatBubble.tsx / useDraggableBubble.ts). Kept dependency-free and
 * side-effect-free so they're trivially unit-testable — no DOM, no
 * localStorage, just numbers in, numbers out.
 */

export interface Size {
	width: number;
	height: number;
}

export interface Point {
	x: number;
	y: number;
}

export interface ClampOptions {
	/** Current viewport (window.innerWidth/innerHeight). */
	viewport: Size;
	/** The bubble's own rendered size. */
	bubbleSize: Size;
	/** Minimum gap kept between the bubble and any screen edge. */
	margin: number;
	/**
	 * Height of a fixed strip at the bottom of the screen the bubble must
	 * never cover (mobile bottom tab bar and/or the sticky recording bar).
	 * Defaults to 0.
	 */
	bottomExclusion?: number;
	/** Height of a fixed strip at the top of the screen to stay clear of
	 *  (e.g. a header). Defaults to 0. */
	topExclusion?: number;
}

/** Clamps a single value into [min, max], swapping them if min > max so a
 *  viewport smaller than the bubble itself never produces an inverted
 *  range (falls back to `min`). */
export function clamp(value: number, min: number, max: number): number {
	if (max < min) return min;
	return Math.min(Math.max(value, min), max);
}

/**
 * Clamps a bubble position so it stays fully inside the viewport, respects
 * `margin` on every side, and never overlaps the top/bottom exclusion
 * strips. Used both while dragging (every pointer move) and on resize/
 * orientation change.
 */
export function clampPosition(pos: Point, opts: ClampOptions): Point {
	const { viewport, bubbleSize, margin, bottomExclusion = 0, topExclusion = 0 } = opts;
	const minX = margin;
	const maxX = Math.max(minX, viewport.width - bubbleSize.width - margin);
	const minY = margin + topExclusion;
	const maxY = Math.max(minY, viewport.height - bubbleSize.height - margin - bottomExclusion);
	return {
		x: clamp(pos.x, minX, maxX),
		y: clamp(pos.y, minY, maxY),
	};
}

/**
 * Snaps the bubble to whichever of the left/right edges its center is
 * currently closest to, keeping `y` where it is (already clamped). This is
 * the "release to dock" behavior — dragging is free-form, but letting go
 * always resolves to a left- or right-docked resting position.
 */
export function snapToNearestEdge(pos: Point, opts: ClampOptions): Point {
	const clamped = clampPosition(pos, opts);
	const { viewport, bubbleSize, margin } = opts;
	const centerX = clamped.x + bubbleSize.width / 2;
	const viewportCenterX = viewport.width / 2;
	const leftX = margin;
	const rightX = Math.max(leftX, viewport.width - bubbleSize.width - margin);
	return {
		x: centerX <= viewportCenterX ? leftX : rightX,
		y: clamped.y,
	};
}

/** True once a pointer has moved past `thresholdPx` from where it went
 *  down — the tap-vs-drag distinguisher used by useDraggableBubble. */
export function isDragDistance(start: Point, current: Point, thresholdPx = 5): boolean {
	const dx = current.x - start.x;
	const dy = current.y - start.y;
	return Math.sqrt(dx * dx + dy * dy) > thresholdPx;
}

/** Which screen edge a clamped position is currently docked to, used to
 *  anchor the desktop chat panel next to the bubble on the correct side. */
export function dockedSide(pos: Point, opts: ClampOptions): "left" | "right" {
	const { viewport, bubbleSize, margin } = opts;
	const rightX = Math.max(margin, viewport.width - bubbleSize.width - margin);
	const distanceToLeft = Math.abs(pos.x - margin);
	const distanceToRight = Math.abs(pos.x - rightX);
	return distanceToRight < distanceToLeft ? "right" : "left";
}
