"use client";

import { useCallback, useState } from "react";
import type { GlossaryQuickAddState } from "./components/GlossaryQuickAddMenu";

/**
 * Wire `onContextMenu={handleContextMenu}` onto any container that holds
 * selectable transcript text (MeetingTranscriptTab.tsx wraps both the
 * per-speaker view and the full-script view with it). If the right-click
 * lands on a non-empty text selection, this hijacks the native context menu
 * to open GlossaryQuickAddMenu instead; any other right-click (no
 * selection) is left alone so the browser's own menu still appears.
 */
export function useGlossaryQuickAdd() {
	const [menu, setMenu] = useState<GlossaryQuickAddState | null>(null);

	const handleContextMenu = useCallback((e: React.MouseEvent) => {
		const selection = window.getSelection()?.toString().trim() ?? "";
		if (!selection) return;
		e.preventDefault();
		setMenu({ x: e.clientX, y: e.clientY, term: selection });
	}, []);

	const closeMenu = useCallback(() => setMenu(null), []);

	return { menu, handleContextMenu, closeMenu };
}
