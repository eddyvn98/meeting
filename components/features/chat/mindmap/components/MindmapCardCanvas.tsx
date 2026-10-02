"use client";

import React, { useState, useMemo, useRef } from "react";
import { ZoomIn, ZoomOut, RotateCcw, HelpCircle } from "lucide-react";
import { MindmapNode, StylePreset, PositionedNode, ConnectionPath, serializeMindmapToText } from "../mindmap-types";
import { getNodeChainIds, parsePathId } from "../mindmap-utils";
import { MindmapCardStylePanel } from "./MindmapCardStylePanel";

interface MindmapCardCanvasProps {
	nodes: PositionedNode[];
	paths: ConnectionPath[];
	bounds: { minX: number; maxX: number; minY: number; maxY: number };
	activePreset: StylePreset;
	setActivePreset: (preset: StylePreset) => void;
	layoutStructure: string;
	setLayoutStructure: (v: string) => void;
	layoutSubOption: number;
	setLayoutSubOption: (v: number) => void;
	nodeShape: "rounded_rect" | "circle" | "underline";
	setNodeShape: (shape: "rounded_rect" | "circle" | "underline") => void;
	isStyleMenuOpen: boolean;
	setIsStyleMenuOpen: (open: boolean) => void;
	zoom: number;
	setZoom: (zoom: number) => void;
	pan: { x: number; y: number };
	setPan: (pan: { x: number; y: number }) => void;
	isDragging: boolean;
	setIsDragging: (v: boolean) => void;
	dragStart: React.MutableRefObject<{ x: number; y: number }>;
	modalContainerRef: React.RefObject<HTMLDivElement>;
	fitView: () => void;
	handleWheel: (e: React.WheelEvent) => void;
	toggleNodeExpanded: (nodeId: string) => void;
	renderNodeShape: (node: PositionedNode, isRoot: boolean, isBranch: boolean) => React.ReactNode;
	tree: MindmapNode;
}

export function MindmapCardCanvas({
	nodes,
	paths,
	bounds,
	activePreset,
	setActivePreset,
	layoutStructure,
	setLayoutStructure,
	layoutSubOption,
	setLayoutSubOption,
	nodeShape,
	setNodeShape,
	isStyleMenuOpen,
	setIsStyleMenuOpen,
	zoom,
	setZoom,
	pan,
	setPan,
	isDragging,
	setIsDragging,
	dragStart,
	modalContainerRef,
	fitView,
	handleWheel,
	toggleNodeExpanded,
	renderNodeShape,
	tree,
}: MindmapCardCanvasProps) {
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const rafRef = useRef<number | null>(null);

	const focusedNodeIds = useMemo(() => {
		return getNodeChainIds(tree, selectedNodeId ? [selectedNodeId] : []);
	}, [tree, selectedNodeId]);

	const nodeIds = useMemo(() => new Set(nodes.map(n => n.id)), [nodes]);

	const handleMouseDown = (e: React.MouseEvent) => {
		if ((e.target as HTMLElement).closest(".node-button") || (e.target as HTMLElement).closest(".style-popover-el")) return;
		if (!(e.target as HTMLElement).closest(".mindmap-node-modal-g")) {
			setSelectedNodeId(null);
		}
		setIsDragging(true);
		dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
	};

	const handleMouseMove = (e: React.MouseEvent) => {
		if (!isDragging) return;
		const x = e.clientX - dragStart.current.x;
		const y = e.clientY - dragStart.current.y;
		if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
		rafRef.current = requestAnimationFrame(() => setPan({ x, y }));
	};

	const handleMouseUp = () => {
		if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
		setIsDragging(false);
	};

	return (
		<div
			ref={modalContainerRef}
			className="flex-1 w-full h-full relative overflow-hidden cursor-grab active:cursor-grabbing transition-colors duration-300"
			style={{ backgroundColor: activePreset.canvasBg }}
			onMouseDown={handleMouseDown}
			onMouseMove={handleMouseMove}
			onMouseUp={handleMouseUp}
			onMouseLeave={handleMouseUp}
			onWheel={handleWheel}
		>
			{/* Grid Background Pattern */}
			<div className="absolute inset-0 bg-[linear-gradient(to_right,#80808007_1px,transparent_1px),linear-gradient(to_bottom,#80808007_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none" />

			{/* Transform Group */}
			<div
				style={{
					transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
					transformOrigin: "0 0",
					transition: isDragging ? "none" : "transform 0.1s ease-out",
				}}
				className="absolute inset-0 w-full h-full"
			>
				<svg
					width={bounds.maxX - bounds.minX + 800}
					height={bounds.maxY - bounds.minY + 600}
					viewBox={`${bounds.minX - 400} ${bounds.minY - 300} ${bounds.maxX - bounds.minX + 800} ${bounds.maxY - bounds.minY + 600}`}
					className="pointer-events-auto w-full h-full"
					style={{ overflow: "visible" }}
				>
					{paths.map((path) => {
						const parsedIds = parsePathId(path.id, nodes, nodeIds);
						const parentId = parsedIds?.parentId;
						const childId = parsedIds?.childId;
						const isPathDimmed = focusedNodeIds !== null && (!parentId || !childId || !focusedNodeIds.has(parentId) || !focusedNodeIds.has(childId));
						return (
							<path
								key={path.id}
								d={path.d}
								fill="none"
								stroke={path.color}
								strokeWidth={2.2}
								strokeLinecap="round"
								opacity={isPathDimmed ? 0.48 : 0.8}
								style={{ transition: "opacity 0.25s ease-in-out" }}
							/>
						);
					})}
					{nodes.map((node) => {
						const isRoot = !node.node.floating && node.level === 0;
						const isBranch = node.level === 1;
						const hasChildren = node.node.children && node.node.children.length > 0;
						const isCollapsed = node.node.expanded === false;
						const isDimmed = focusedNodeIds !== null && !focusedNodeIds.has(node.id);
						return (
							<g
								key={`node-modal-${node.id}`}
								className="mindmap-node-modal-g cursor-pointer"
								style={{ opacity: isDimmed ? 0.6 : 1, transition: "opacity 0.25s ease-in-out" }}

								onClick={(e) => {
									e.stopPropagation();
									setSelectedNodeId((prev) => (prev === node.id ? null : node.id));
								}}
							>
								{renderNodeShape(node, isRoot, isBranch)}
								<foreignObject x={node.x + 6} y={node.y - 8} width={node.width - 12} height={16}>
									<div
										style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: `${node.width - 12}px` }}
										className={`text-[10.5px] font-semibold font-sans select-none pointer-events-none transition-colors duration-300 ${isRoot ? "text-white" : isBranch ? "text-slate-200" : "text-slate-300"}`}
									>
										{node.topic}
									</div>
								</foreignObject>
								{hasChildren && (
									<circle cx={node.direction === "left" ? node.x : node.x + node.width} cy={node.y} r={6}
										fill={isCollapsed ? node.branchColor : "#ffffff"} stroke={node.branchColor} strokeWidth={2}
										className="node-button cursor-pointer"
										onClick={(e) => { e.stopPropagation(); toggleNodeExpanded(node.id); }}
									/>
								)}
							</g>
						);
					})}
				</svg>
			</div>


			{/* Help tooltip */}
			<div className="absolute bottom-4 left-4 p-3 bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl max-w-[280px] pointer-events-none select-none z-10">
				<div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
					<HelpCircle size={13} className="text-orange-500" />
					<span>Navigation Guide</span>
				</div>
				<ul className="text-[10px] text-slate-500 dark:text-slate-400 space-y-1 pl-1 list-disc">
					<li>Click & drag to move the canvas</li>
					<li>Use zoom buttons or mouse wheel</li>
					<li>Click the circular icon on a node to expand/collapse child branches</li>
				</ul>
			</div>

			{/* Bottom Floating Control Bar */}
			<div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-white/95 dark:bg-slate-900/85 backdrop-blur-md border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-2xl flex items-center gap-4.5 shadow-xl z-20">
				<MindmapCardStylePanel
					isStyleMenuOpen={isStyleMenuOpen}
					setIsStyleMenuOpen={setIsStyleMenuOpen}
					layoutStructure={layoutStructure}
					setLayoutStructure={setLayoutStructure}
					layoutSubOption={layoutSubOption}
					setLayoutSubOption={setLayoutSubOption}
					activePreset={activePreset}
					setActivePreset={setActivePreset}
					nodeShape={nodeShape}
					setNodeShape={setNodeShape}
				/>
				<div className="flex items-center gap-1 border-r border-slate-200 dark:border-slate-800 pr-4">
					<button onClick={() => setZoom(Math.max(0.3, zoom - 0.1))} className="h-7 w-7 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer" title="Zoom Out">
						<ZoomOut className="w-4 h-4" />
					</button>
					<span className="text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-300 w-11 text-center select-none">
						{Math.round(zoom * 100)}%
					</span>
					<button onClick={() => setZoom(Math.min(3, zoom + 0.1))} className="h-7 w-7 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer" title="Zoom In">
						<ZoomIn className="w-4 h-4" />
					</button>
					<button onClick={fitView} className="h-7 w-7 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer ml-1" title="Reset View / Fit Canvas">
						<RotateCcw className="w-3.5 h-3.5" />
					</button>
				</div>
				<button
					onClick={() => {
						const serialized = serializeMindmapToText(tree);
						const blob = new Blob([serialized], { type: "text/plain;charset=utf-8" });
						const url = URL.createObjectURL(blob);
						const link = document.createElement("a");
						link.href = url;
						link.download = `${tree.topic}.md`;
						link.click();
						URL.revokeObjectURL(url);
					}}
					className="h-7 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white text-[11px] font-bold rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors"
				>
					<RotateCcw className="w-3 h-3 rotate-180" />
					Export MindMap
				</button>
			</div>
		</div>
	);
}
