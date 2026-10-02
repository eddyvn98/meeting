"use client";

import { useMemo } from "react";
import { MindmapNode, StylePreset } from "../mindmap-types";
import { runPreviewDispatch } from "./layouts/previewLayoutCore";

export function usePreviewCardLayout(
	tree: MindmapNode,
	activePreset: StylePreset,
	layoutStructure: string,
	nodeShape: "rounded_rect" | "circle" | "underline",
	nodeWidth: number,
	nodeHeight: number,
	xGap: number,
	yGap: number,
	layoutSubOption?: number
) {
	return useMemo(
		() => runPreviewDispatch({
			tree,
			activePreset,
			layoutStructure,
			nodeShape,
			nodeWidth,
			nodeHeight,
			xGap,
			yGap,
			layoutSubOption,
		}),
		[tree, activePreset, layoutStructure, nodeShape, nodeWidth, nodeHeight, xGap, yGap, layoutSubOption]
	);
}
