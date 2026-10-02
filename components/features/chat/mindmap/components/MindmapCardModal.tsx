"use client";

import React from "react";
import { Edit3, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MindmapNode, StylePreset, PositionedNode, ConnectionPath } from "../mindmap-types";
import { MindmapCardCanvas } from "./MindmapCardCanvas";

interface MindmapCardModalProps {
	isExpandedModal: boolean;
	tree: MindmapNode;
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
	handleEdit: () => void;
	toggleNodeExpanded: (nodeId: string) => void;
	renderNodeShape: (node: PositionedNode, isRoot: boolean, isBranch: boolean) => React.ReactNode;
	onClose: () => void;
}

export function MindmapCardModal({
	isExpandedModal,
	tree,
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
	handleEdit,
	toggleNodeExpanded,
	renderNodeShape,
	onClose,
}: MindmapCardModalProps) {
	return (
		<AnimatePresence>
			{isExpandedModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md select-none">
					<motion.div
						initial={{ opacity: 0, scale: 0.95, y: 15 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						exit={{ opacity: 0, scale: 0.95, y: 15 }}
						transition={{ duration: 0.25 }}
						className="flex flex-col bg-white dark:bg-slate-900 w-full max-w-[90vw] h-[85vh] rounded-3xl overflow-hidden shadow-2xl border border-slate-200/80 dark:border-slate-800/80"
					>
						{/* Modal Header */}
						<div className="flex items-center justify-between px-6 py-4 bg-slate-50 dark:bg-slate-950/40 border-b border-slate-200/80 dark:border-slate-800/80">
							<div className="flex items-center gap-3">
								<h3 className="text-[16px] font-bold text-slate-800 dark:text-slate-100">
									{tree.topic}
								</h3>
								<span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium">
									Mind Map
								</span>
							</div>
							<div className="flex items-center gap-2">
								<button
									onClick={handleEdit}
									className="flex items-center gap-1.5 px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-[13px] font-bold shadow-md shadow-orange-500/25 hover:shadow-orange-500/35 transition-all cursor-pointer"
								>
									<Edit3 size={14} />
									<span>Edit</span>
								</button>
								<button
									onClick={onClose}
									className="p-2 rounded-xl text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
								>
									<X size={18} />
								</button>
							</div>
						</div>

						{/* Canvas with zoom/pan/controls */}
						<MindmapCardCanvas
							nodes={nodes}
							paths={paths}
							bounds={bounds}
							activePreset={activePreset}
							setActivePreset={setActivePreset}
							layoutStructure={layoutStructure}
							setLayoutStructure={setLayoutStructure}
							layoutSubOption={layoutSubOption}
							setLayoutSubOption={setLayoutSubOption}
							nodeShape={nodeShape}
							setNodeShape={setNodeShape}
							isStyleMenuOpen={isStyleMenuOpen}
							setIsStyleMenuOpen={setIsStyleMenuOpen}
							zoom={zoom}
							setZoom={setZoom}
							pan={pan}
							setPan={setPan}
							isDragging={isDragging}
							setIsDragging={setIsDragging}
							dragStart={dragStart}
							modalContainerRef={modalContainerRef}
							fitView={fitView}
							handleWheel={handleWheel}
							toggleNodeExpanded={toggleNodeExpanded}
							renderNodeShape={renderNodeShape}
							tree={tree}
						/>
					</motion.div>
				</div>
			)}
		</AnimatePresence>
	);
}
