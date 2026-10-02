import { useEffect } from "react";
import { useToolLayoutStore, type ToolLayoutSlots } from "@/stores/useToolLayoutStore";

/**
 * Registers this page's ToolLayout slot content (aside/breadcrumb/headerActions/
 * showHistory) with the persistent ToolLayout rendered in app/(tools)/layout.tsx.
 * Resets on unmount so the next page doesn't inherit stale slots.
 *
 * Runs once on mount (not on every re-render): slot content is JSX created fresh
 * on each call, so a reference-based dependency array would fire on every render
 * of the calling page (e.g. every keystroke in a chat input) and force ToolLayout
 * to re-render with it. None of our slots depend on reactive page state, so
 * register-once-per-mount is both correct and avoids that churn.
 */
export function useToolLayoutSlots(slots: ToolLayoutSlots) {
	const setSlots = useToolLayoutStore((s) => s.setSlots);
	const resetSlots = useToolLayoutStore((s) => s.resetSlots);

	useEffect(() => {
		setSlots(slots);
		return () => resetSlots();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
}
