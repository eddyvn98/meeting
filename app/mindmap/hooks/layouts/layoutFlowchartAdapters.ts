"use client";

import { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import { layoutFlowchart, layoutSwimlane } from "@/components/features/chat/mindmap/hooks/layouts/newLayouts";
import { PositionedNode, ConnectionPath, NODE_WIDTH, NODE_HEIGHT, X_GAP, Y_GAP } from "./layoutHelpers";

const FAKE_LINE_COLOR = "#475569";

export function translatePath(d: string, dx: number, dy: number): string {
	if (dx === 0 && dy === 0) return d;
	const tokens = d.match(/[A-Za-z][^A-Za-z]*/g) || [];
	return tokens.map(token => {
		const cmd = token[0];
		const nums = token.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number);
		switch (cmd.toUpperCase()) {
			case "H": return cmd + " " + nums.map(n => n + dx).join(" ");
			case "V": return cmd + " " + nums.map(n => n + dy).join(" ");
			default: {
				const shifted = nums.map((n, i) => n + (i % 2 === 0 ? dx : dy));
				return cmd + " " + shifted.join(" ");
			}
		}
		// Space-separated: joining with "" yields "M 1 2H 3", which is legal SVG but
		// breaks whitespace-splitting path parsers such as pointsFromPath.
	}).join(" ");
}

export function runLayoutFlowchart(
	tree: MindmapNode,
	activeColors: string[],
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	startY = 40
): void {
	const fakePreset = {
		id: "page", name: "page", bgClass: "", canvasBg: "",
		lineColor: FAKE_LINE_COLOR, rootBg: "", branchColors: activeColors,
		rootTextColor: "", branchTextColor: "",
	};
	const result = layoutFlowchart(tree, fakePreset as any, 1, NODE_WIDTH, NODE_HEIGHT, X_GAP, Y_GAP);
	const dy = startY - 40;
	result.positioned.forEach(n => positioned.push({ ...n, y: n.y + dy }));
	result.connections.forEach(c => connections.push({ ...c, d: translatePath(c.d, 0, dy) }));
}

export function runLayoutSwimlane(
	tree: MindmapNode,
	activeColors: string[],
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	startY = 40
): void {
	const fakePreset = {
		id: "page", name: "page", bgClass: "", canvasBg: "",
		lineColor: FAKE_LINE_COLOR, rootBg: "", branchColors: activeColors,
		rootTextColor: "", branchTextColor: "",
	};
	const result = layoutSwimlane(tree, fakePreset as any, 1, NODE_WIDTH, NODE_HEIGHT, X_GAP, Y_GAP);
	const dy = startY - 40;
	// Skip all root→lane connectors (chrome draws the visual header; root id prefix covers
	// both direct children and auto-unwrapped grandchildren used as lanes)
	const rootPrefix = `${tree.id}-`;
	result.positioned.forEach(n => positioned.push({ ...n, y: n.y + dy }));
	result.connections
		.filter(c => !c.id.startsWith(rootPrefix))
		.forEach(c => connections.push({ ...c, d: translatePath(c.d, 0, dy) }));
}
