"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clampPosition, dockedSide, isDragDistance, snapToNearestEdge, type Point } from "@/lib/meeting/ui/bubblePosition";

const STORAGE_KEY = "meeting-ask-bubble-position";
const BUBBLE_SIZE = { width: 56, height: 56 };
const MARGIN = 16;
/** Keeps the bubble clear of the mobile bottom tab bar (~56px) and, on
 *  desktop, the sticky recording bar isn't full-width so no strip is
 *  needed there — this constant only applies below `sm`. */
const MOBILE_BOTTOM_EXCLUSION = 76;

function defaultPosition(viewportWidth: number, viewportHeight: number): Point {
	return {
		x: Math.max(MARGIN, viewportWidth - BUBBLE_SIZE.width - MARGIN),
		y: Math.max(MARGIN, viewportHeight - BUBBLE_SIZE.height - MARGIN - MOBILE_BOTTOM_EXCLUSION),
	};
}

function loadStoredPosition(): Point | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<Point>;
		if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return null;
		return { x: parsed.x, y: parsed.y };
	} catch {
		return null;
	}
}

function saveStoredPosition(pos: Point) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
	} catch {
		// Private browsing / storage disabled — position just won't persist.
	}
}

function clampOpts() {
	return {
		viewport: { width: window.innerWidth, height: window.innerHeight },
		bubbleSize: BUBBLE_SIZE,
		margin: MARGIN,
		bottomExclusion: window.innerWidth < 640 ? MOBILE_BOTTOM_EXCLUSION : 0,
	};
}

/**
 * Drives the draggable, edge-snapping floating "Ask AI" bubble
 * (AskChatBubble.tsx). Pointer events (works for mouse + touch via pointer
 * capture) track movement; a ~5px threshold distinguishes a drag from a
 * tap so a plain click still opens the chat panel instead of being
 * swallowed as a zero-distance drag. On release, the bubble animates to
 * the nearest left/right edge and the resting position is persisted to
 * localStorage, then re-clamped on resize/orientation change so it can
 * never end up off-screen or over the bottom nav after a viewport change.
 */
export function useDraggableBubble(onTap: () => void) {
	const [position, setPosition] = useState<Point>(() => defaultPosition(1024, 768));
	const [dragging, setDragging] = useState(false);
	const [side, setSide] = useState<"left" | "right">("right");
	const dragStateRef = useRef<{ pointerId: number; pointerStart: Point; bubbleStart: Point; dragged: boolean } | null>(null);
	const bubbleRef = useRef<HTMLButtonElement | null>(null);

	// Resolve the real starting position only on the client (localStorage +
	// window size aren't available during SSR).
	useEffect(() => {
		const stored = loadStoredPosition();
		const opts = clampOpts();
		const resolved = clampPosition(stored ?? defaultPosition(opts.viewport.width, opts.viewport.height), opts);
		setPosition(resolved);
		setSide(dockedSide(resolved, opts));
	}, []);

	// Re-clamp (never re-snap — a resize shouldn't flip which edge you docked
	// to, only pull the bubble back on-screen if it no longer fits) whenever
	// the viewport changes.
	useEffect(() => {
		const handleResize = () => {
			const opts = clampOpts();
			setPosition((prev) => {
				const clamped = clampPosition(prev, opts);
				setSide(dockedSide(clamped, opts));
				return clamped;
			});
		};
		window.addEventListener("resize", handleResize);
		window.addEventListener("orientationchange", handleResize);
		return () => {
			window.removeEventListener("resize", handleResize);
			window.removeEventListener("orientationchange", handleResize);
		};
	}, []);

	const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
		e.currentTarget.setPointerCapture(e.pointerId);
		dragStateRef.current = {
			pointerId: e.pointerId,
			pointerStart: { x: e.clientX, y: e.clientY },
			bubbleStart: position,
			dragged: false,
		};
		setDragging(true);
	}, [position]);

	const handlePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
		const drag = dragStateRef.current;
		if (!drag || e.pointerId !== drag.pointerId) return;
		const current = { x: e.clientX, y: e.clientY };
		if (!drag.dragged && !isDragDistance(drag.pointerStart, current)) return;
		drag.dragged = true;
		const next = {
			x: drag.bubbleStart.x + (current.x - drag.pointerStart.x),
			y: drag.bubbleStart.y + (current.y - drag.pointerStart.y),
		};
		setPosition(clampPosition(next, clampOpts()));
	}, []);

	const endDrag = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
		const drag = dragStateRef.current;
		if (!drag || e.pointerId !== drag.pointerId) return;
		dragStateRef.current = null;
		setDragging(false);
		if (!drag.dragged) {
			onTap();
			return;
		}
		setPosition((prev) => {
			const opts = clampOpts();
			const snapped = snapToNearestEdge(prev, opts);
			saveStoredPosition(snapped);
			setSide(dockedSide(snapped, opts));
			return snapped;
		});
	}, [onTap]);

	const handlePointerUp = endDrag;
	const handlePointerCancel = endDrag;

	return {
		position,
		dragging,
		side,
		bubbleRef,
		bubbleSize: BUBBLE_SIZE,
		handlers: {
			onPointerDown: handlePointerDown,
			onPointerMove: handlePointerMove,
			onPointerUp: handlePointerUp,
			onPointerCancel: handlePointerCancel,
		},
	};
}
