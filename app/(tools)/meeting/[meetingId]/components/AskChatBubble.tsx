"use client";

import { useEffect } from "react";
import { Sparkles } from "lucide-react";
import { useDraggableBubble } from "../useDraggableBubble";
import type { Point } from "@/lib/meeting/ui/bubblePosition";

/**
 * Floating, draggable "Ask AI" entry point (replaces the old "Ask" tab —
 * see MeetingResultTabs.tsx). Renders as a circular brand-orange button
 * fixed above page content; useDraggableBubble.ts owns the drag/snap/
 * persistence behavior, this component is just presentation + the unread
 * badge.
 */
export function AskChatBubble({
	open,
	hasUnread,
	onTap,
	onGeometryChange,
	buttonRef,
}: {
	open: boolean;
	hasUnread: boolean;
	onTap: () => void;
	/** Reports the bubble's current position/docked edge/size up so
	 *  AskChatPanel can anchor itself next to it on desktop. */
	onGeometryChange?: (geometry: { position: Point; side: "left" | "right"; size: { width: number; height: number } }) => void;
	/** Lets the parent (page.tsx) get the button's DOM node too, so focus
	 *  can be returned to it when AskChatPanel closes. */
	buttonRef?: { current: HTMLButtonElement | null };
}) {
	const { position, dragging, side, bubbleRef, bubbleSize, handlers } = useDraggableBubble(onTap);

	useEffect(() => {
		onGeometryChange?.({ position, side, size: bubbleSize });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [position, side]);

	return (
		<button
			ref={(node) => {
				bubbleRef.current = node;
				if (buttonRef) buttonRef.current = node;
			}}
			type="button"
			aria-label="Open Ask AI chat"
			aria-expanded={open}
			{...handlers}
			style={{
				position: "fixed",
				left: position.x,
				top: position.y,
				width: bubbleSize.width,
				height: bubbleSize.height,
				touchAction: "none",
			}}
			className={`z-40 flex items-center justify-center rounded-full bg-brand-orange text-white shadow-lg outline-none ring-brand-orange/50 transition-[transform,box-shadow] hover:brightness-105 focus-visible:ring-2 motion-reduce:transition-none ${
				dragging ? "scale-105 cursor-grabbing" : "cursor-grab"
			} ${open ? "ring-2" : ""}`}
		>
			<Sparkles className="h-6 w-6" />
			{hasUnread && !open && (
				<span
					aria-hidden
					className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-background bg-red-500"
				/>
			)}
		</button>
	);
}
