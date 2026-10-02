"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MeetingOverviewListModal } from "./MeetingOverviewListModal";

/** Height of the visible part of a section card body, about six lines. */
const COLLAPSED_MAX_HEIGHT_PX = 168;

/**
 * Shows only the first few lines of a section card's body. When the content is
 * taller, the bottom fades out and a "Show more" button opens the full content
 * in a floating dialog (Esc, the X button or a click outside closes it). The
 * same `children` render in the dialog, so a section that can be edited stays
 * editable there.
 */
export function CollapsibleSectionBody({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
	const outerRef = useRef<HTMLDivElement>(null);
	const innerRef = useRef<HTMLDivElement>(null);
	const [overflowing, setOverflowing] = useState(false);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		const outer = outerRef.current;
		const inner = innerRef.current;
		if (!outer || !inner) return;
		const measure = () => setOverflowing(inner.offsetHeight > COLLAPSED_MAX_HEIGHT_PX + 1);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(inner);
		return () => observer.disconnect();
	}, []);

	return (
		<>
			<div ref={outerRef} className="relative flex-1 overflow-hidden" style={{ maxHeight: COLLAPSED_MAX_HEIGHT_PX }}>
				<div ref={innerRef}>{children}</div>
				{overflowing && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />}
			</div>
			{overflowing && (
				<button type="button" onClick={() => setOpen(true)} className="mt-2 self-start text-xs font-medium text-primary hover:underline">
					Show more ›
				</button>
			)}
			{footer}
			{open && (
				<MeetingOverviewListModal title={title} onClose={() => setOpen(false)} footer={footer}>
					{children}
				</MeetingOverviewListModal>
			)}
		</>
	);
}
