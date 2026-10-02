import type { ReactNode } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ToolLayoutSlots {
	aside?: ReactNode;
	showHistory?: boolean;
	breadcrumb?: ReactNode;
	headerActions?: ReactNode;
	hideTopAsideToggle?: boolean;
}

interface ToolLayoutStore extends ToolLayoutSlots {
	asideCollapsed: boolean;
	setAsideCollapsed: (collapsed: boolean) => void;
	mindmapAsideCollapsed: boolean;
	setMindmapAsideCollapsed: (collapsed: boolean) => void;
	/** Home ("/") has its own collapsed flag, defaulting closed, so the docked
	 * aside doesn't open unexpectedly on first load the way the shared
	 * asideCollapsed (default open) would. */
	homeAsideCollapsed: boolean;
	setHomeAsideCollapsed: (collapsed: boolean) => void;
	/** User-dragged aside width (px), persisted per route family like the collapsed flags above. */
	asideWidth: number;
	setAsideWidth: (width: number) => void;
	mindmapAsideWidth: number;
	setMindmapAsideWidth: (width: number) => void;
	setSlots: (slots: ToolLayoutSlots) => void;
	resetSlots: () => void;
}

export const ASIDE_WIDTH_DEFAULT = 240;

const defaultSlots: ToolLayoutSlots = {
	aside: undefined,
	showHistory: true,
	breadcrumb: undefined,
	headerActions: undefined,
	hideTopAsideToggle: false,
};

/**
 * Lets a page register its ToolLayout slot content (aside/breadcrumb/etc.)
 * when ToolLayout itself lives in a persistent parent layout (app/(tools)/layout.tsx)
 * instead of being re-mounted by each page.
 */
export const useToolLayoutStore = create<ToolLayoutStore>()(
	persist(
		(set) => ({
			...defaultSlots,
			asideCollapsed: false,
			mindmapAsideCollapsed: true,
			homeAsideCollapsed: true,
			asideWidth: ASIDE_WIDTH_DEFAULT,
			mindmapAsideWidth: ASIDE_WIDTH_DEFAULT,
			setAsideCollapsed: (collapsed) => set({ asideCollapsed: collapsed }),
			setMindmapAsideCollapsed: (collapsed) => set({ mindmapAsideCollapsed: collapsed }),
			setHomeAsideCollapsed: (collapsed) => set({ homeAsideCollapsed: collapsed }),
			setAsideWidth: (width) => set({ asideWidth: width }),
			setMindmapAsideWidth: (width) => set({ mindmapAsideWidth: width }),
			setSlots: (slots) => set((state) => ({
				...defaultSlots,
				...slots,
				asideCollapsed: state.asideCollapsed,
				mindmapAsideCollapsed: state.mindmapAsideCollapsed,
				homeAsideCollapsed: state.homeAsideCollapsed,
				asideWidth: state.asideWidth,
				mindmapAsideWidth: state.mindmapAsideWidth,
			})),
			resetSlots: () => set((state) => ({
				...defaultSlots,
				asideCollapsed: state.asideCollapsed,
				mindmapAsideCollapsed: state.mindmapAsideCollapsed,
				homeAsideCollapsed: state.homeAsideCollapsed,
				asideWidth: state.asideWidth,
				mindmapAsideWidth: state.mindmapAsideWidth,
			})),
		}),
		{
			name: "mindmap_tool_layout_v1",
			partialize: (state) => ({
				mindmapAsideCollapsed: state.mindmapAsideCollapsed,
				asideWidth: state.asideWidth,
				mindmapAsideWidth: state.mindmapAsideWidth,
			}),
		}
	)
);
