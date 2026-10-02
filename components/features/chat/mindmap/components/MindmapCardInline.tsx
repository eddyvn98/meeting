"use client";

import React from "react";
import { Maximize2, Edit3 } from "lucide-react";
import { PositionedNode, ConnectionPath, StylePreset } from "../mindmap-types";

interface MindmapCardInlineProps {
	nodes: PositionedNode[];
	paths: ConnectionPath[];
	previewViewBox: string;
	activePreset: StylePreset;
	nodeShape: "rounded_rect" | "circle" | "underline";
	onExpand: () => void;
	onEdit: () => void;
	toggleNodeExpanded: (nodeId: string) => void;
	renderNodeShape: (node: PositionedNode, isRoot: boolean, isBranch: boolean) => React.ReactNode;
}

export function MindmapCardInline({
	nodes,
	paths,
	previewViewBox,
	activePreset,
	nodeShape,
	onExpand,
	onEdit,
	toggleNodeExpanded,
	renderNodeShape,
}: MindmapCardInlineProps) {
	return (
		<div className="my-4 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/30 shadow-sm w-full max-w-full">
			{/* Top toolbar */}
			<div className="flex items-center justify-between px-4 py-2 bg-slate-100/70 dark:bg-slate-800/50 border-b border-slate-200/80 dark:border-slate-800/80">
				<div className="flex items-center gap-2">
					<span className="text-[12px] font-semibold text-slate-700 dark:text-slate-300 font-sans tracking-wide">
						Mind Map Preview
					</span>
					<span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400 font-bold font-mono">
						AI-GEN
					</span>
				</div>
				<div className="flex items-center gap-1.5">
					<button
						onClick={onExpand}
						className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/55 dark:hover:bg-slate-700/60 transition-colors cursor-pointer"
						title="Expand (Fullscreen)"
					>
						<Maximize2 size={14} />
					</button>
					<button
						onClick={onEdit}
						className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/55 dark:hover:bg-slate-700/60 transition-colors cursor-pointer"
						title="Edit"
					>
						<Edit3 size={14} />
					</button>
				</div>
			</div>

			{/* Visual preview viewport */}
			<div
				className="p-4 w-full relative min-h-[160px] max-h-[260px] flex items-center justify-center overflow-hidden transition-colors duration-300"
				style={{ backgroundColor: activePreset.canvasBg }}
			>
				<svg
					viewBox={previewViewBox}
					className="w-full h-full max-h-[220px] mx-auto"
					style={{ overflow: "visible" }}
				>
					{/* Connections */}
					{paths.map((path) => (
						<path
							key={path.id}
							d={path.d}
							fill="none"
							stroke={path.color}
							strokeWidth={2}
							strokeLinecap="round"
							opacity={0.7}
						/>
					))}

					{/* Nodes */}
					{nodes.map((node) => {
						const isRoot = !node.node.floating && node.level === 0;
						const isBranch = node.level === 1;
						const hasChildren = node.node.children && node.node.children.length > 0;
						const isCollapsed = node.node.expanded === false;

						return (
							<g
								key={`node-group-${node.id}`}
								className="cursor-pointer"
								onClick={(e) => {
									e.stopPropagation();
									toggleNodeExpanded(node.id);
								}}
							>
								{renderNodeShape(node, isRoot, isBranch)}

								{/* Text content */}
								<text
									x={node.x + node.width / 2}
									y={node.y}
									textAnchor="middle"
									dominantBaseline="central"
									className={`
										text-[10px] font-semibold font-sans select-none pointer-events-none transition-colors duration-300
										${isRoot ? "fill-white" : isBranch ? "fill-slate-200" : "fill-slate-300"}
									`}
								>
									{node.topic.length > 18 ? node.topic.substring(0, 16) + "..." : node.topic}
								</text>

								{/* Expand/Collapse badge indicator */}
								{hasChildren && (
									<circle
										cx={node.direction === "left" ? node.x : node.x + node.width}
										cy={node.y}
										r={5}
										fill={isCollapsed ? node.branchColor : "#ffffff"}
										stroke={node.branchColor}
										strokeWidth={1.5}
										className="node-button cursor-pointer"
										onClick={(e) => {
											e.stopPropagation();
											toggleNodeExpanded(node.id);
										}}
									/>
								)}
							</g>
						);
					})}
				</svg>
			</div>
		</div>
	);
}
