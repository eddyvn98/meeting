"use client";

import { useEffect, useRef, useState } from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import type { Point } from "@/lib/meeting/ui/bubblePosition";

/**
 * Owns the small pile of state page.tsx needs to wire up AskChatBubble +
 * AskChatPanel: open/closed, the unread badge, the bubble's current
 * geometry (for the desktop panel's anchor), and normalizing a legacy
 * `?tab=ask` deep link into opening the panel instead of selecting a tab
 * that no longer exists (see MeetingResultTabs.tsx).
 */
export function useAskChatState({
	tabParam,
	searchParams,
	pathname,
	replace,
}: {
	tabParam: string | null;
	searchParams: ReadonlyURLSearchParams;
	pathname: string;
	replace: (href: string, opts: { scroll: boolean }) => void;
}) {
	const [open, setOpen] = useState(false);
	const [unread, setUnread] = useState(false);
	const [bubbleGeometry, setBubbleGeometry] = useState<{
		position: Point;
		side: "left" | "right";
		size: { width: number; height: number };
	} | null>(null);
	const buttonRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		if (tabParam !== "ask") return;
		setOpen(true);
		const next = new URLSearchParams(searchParams.toString());
		next.delete("tab");
		const query = next.toString();
		replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tabParam]);

	const toggle = () => {
		setOpen((prev) => !prev);
		setUnread(false);
	};

	return { open, setOpen, unread, onAnsweredWhileClosed: () => setUnread(true), bubbleGeometry, setBubbleGeometry, buttonRef, toggle };
}
