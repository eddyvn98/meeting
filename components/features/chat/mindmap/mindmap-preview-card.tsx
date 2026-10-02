"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MindmapNode, parseMindmapText, StylePreset, STYLE_PRESETS, PositionedNode } from "./mindmap-types";
import { useRouter } from "next/navigation";
import { useMindmapStore } from "@/stores/useMindmapStore";
import { usePreviewCardLayout } from "./hooks/usePreviewCardLayout";
import { MindmapCardInline } from "./components/MindmapCardInline";
import { MindmapCardModal } from "./components/MindmapCardModal";
import { createMindmapInBackend } from "@/app/mindmap/hooks/createMindmapBackend";
import { toast } from "sonner";

interface MindmapPreviewCardProps {
	code: string;
}

export function MindmapPreviewCard({ code }: MindmapPreviewCardProps) {
	const initialTree = useMemo(() => parseMindmapText(code), [code]);
	const [tree, setTree] = useState<MindmapNode>(initialTree);
	const [isExpandedModal, setIsExpandedModal] = useState(false);
	const router = useRouter();
	const { setCurrentTree, setCurrentMindmapId, setSidebarView, setMindmapList } = useMindmapStore();

	// Style states
	const [activePreset, setActivePreset] = useState<StylePreset>(STYLE_PRESETS[0]);
	const [layoutStructure, setLayoutStructure] = useState<string>("mindmap");
	const [layoutSubOption, setLayoutSubOption] = useState<number>(1);
	const [nodeShape, setNodeShape] = useState<"rounded_rect" | "circle" | "underline">("rounded_rect");
	const [isStyleMenuOpen, setIsStyleMenuOpen] = useState(false);

	// Zoom and Pan state for Modal
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [isDragging, setIsDragging] = useState(false);
	const dragStart = useRef({ x: 0, y: 0 });
	const modalContainerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		setTree(parseMindmapText(code));
	}, [code]);

	// Toggle node expansion
	const toggleNodeExpanded = (nodeId: string) => {
		const toggle = (n: MindmapNode): MindmapNode => {
			if (n.id === nodeId) {
				return { ...n, expanded: n.expanded === false ? true : false };
			}
			return {
				...n,
				children: n.children.map(toggle),
			};
		};
		setTree(toggle(tree));
	};

	// Layout parameters
	const nodeWidth = 140;
	const nodeHeight = 36;
	const xGap = 50;
	const yGap = 12;

	const { nodes, paths, bounds } = usePreviewCardLayout(
		tree,
		activePreset,
		layoutStructure,
		nodeShape,
		nodeWidth,
		nodeHeight,
		xGap,
		yGap,
		layoutSubOption
	);

	// ViewBox for compact preview
	const previewViewBox = useMemo(() => {
		const padding = 30;
		const width = bounds.maxX - bounds.minX + padding * 2;
		const height = bounds.maxY - bounds.minY + padding * 2;
		return `${bounds.minX - padding} ${bounds.minY - padding} ${width} ${height}`;
	}, [bounds]);

	// Fit view in lightbox modal
	const fitView = () => {
		if (!modalContainerRef.current) return;
		const containerWidth = modalContainerRef.current.clientWidth;
		const containerHeight = modalContainerRef.current.clientHeight;

		const mapWidth = bounds.maxX - bounds.minX;
		const mapHeight = bounds.maxY - bounds.minY;

		const scaleX = (containerWidth - 80) / mapWidth;
		const scaleY = (containerHeight - 80) / mapHeight;
		const newZoom = Math.min(1.5, Math.max(0.3, Math.min(scaleX, scaleY)));

		const centerX = bounds.minX + mapWidth / 2;
		const centerY = bounds.minY + mapHeight / 2;

		setZoom(newZoom);
		setPan({
			x: containerWidth / 2 - centerX * newZoom,
			y: containerHeight / 2 - centerY * newZoom,
		});
	};

	// Fit view on modal open
	useEffect(() => {
		if (isExpandedModal) {
			setTimeout(fitView, 100);
		}
	}, [isExpandedModal, bounds.maxX, bounds.maxY]);

	// Fit view on window resize
	useEffect(() => {
		if (!isExpandedModal) return;
		window.addEventListener("resize", fitView);
		return () => window.removeEventListener("resize", fitView);
	}, [isExpandedModal, bounds.maxX, bounds.maxY]);

	// Zoom to cursor with wheel
	const handleWheel = (e: React.WheelEvent) => {
		e.preventDefault();
		const zoomFactor = 1.1;
		const newZoom = e.deltaY < 0 ? zoom * zoomFactor : zoom / zoomFactor;
		const nextZoom = Math.min(3, Math.max(0.2, newZoom));

		const rect = modalContainerRef.current?.getBoundingClientRect();
		if (!rect) return;
		const mouseX = e.clientX - rect.left;
		const mouseY = e.clientY - rect.top;

		const dx = mouseX - pan.x;
		const dy = mouseY - pan.y;

		setZoom(nextZoom);
		setPan({
			x: mouseX - dx * (nextZoom / zoom),
			y: mouseY - dy * (nextZoom / zoom),
		});
	};

	// Persists this card's tree to the backend only once — repeated clicks (or
	// a race from a fast double-click) reused the same id instead of POSTing
	// a fresh duplicate mindmap row.
	const createdIdRef = useRef<string | null>(null);
	const isCreatingRef = useRef(false);
	const handleEdit = async () => {
		if (createdIdRef.current) {
			router.push(`/mindmap?id=${createdIdRef.current}`);
			return;
		}
		if (isCreatingRef.current) return;
		isCreatingRef.current = true;
		try {
			const record = await createMindmapInBackend({ title: tree.topic, tree });
			createdIdRef.current = record.id;
			const persistedTree = record.tree || tree;
			// Creation-stamped: the sidebar orders by that, and an entry without one falls back to `updatedAt` and jumps on every edit.
			const now = Date.now();
			const item = { id: record.id, title: record.title || persistedTree.topic, updatedAt: now, createdAt: now };
			const listRaw = localStorage.getItem("mindmaps_list") || "[]";
			try {
				const list = JSON.parse(listRaw) as { id: string; title: string; updatedAt: number }[];
				const updated = [item, ...list.filter((entry) => entry.id !== record.id)];
				localStorage.setItem("mindmaps_list", JSON.stringify(updated));
				setMindmapList(updated);
			} catch {}
			setCurrentTree(persistedTree, record.id);
			setCurrentMindmapId(record.id);
			setSidebarView("outline");
			router.push(`/mindmap?id=${record.id}`);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to open mindmap");
		} finally {
			isCreatingRef.current = false;
		}
	};

	// Helper to render node shape container SVG based on Node Shape and Preset
	const renderNodeShape = (node: PositionedNode, isRoot: boolean, isBranch: boolean) => {
		const customBgColor = node.node.style?.bgColor ?? node.node.style?.color;
		const customBorderColor = node.node.style?.borderColor ?? node.node.style?.color;

		const strokeColor = customBorderColor ?? (isRoot ? activePreset.rootBorder : node.branchColor);
		const strokeWidth = isRoot ? 2 : 1.8;
		const fillColor = isRoot
			? (customBgColor ?? activePreset.rootBg)
			: (customBgColor ?? (isBranch ? `${node.branchColor}18` : `${node.branchColor}08`));

		const shadowFilter = "drop-shadow(0 4px 6px rgba(0,0,0,0.06))";
		const bgOpacity = node.node.style?.bgOpacity !== undefined ? node.node.style.bgOpacity / 100 : undefined;

		if (nodeShape === "rounded_rect") {
			return (
				<rect
					x={node.x}
					y={node.y - node.height / 2}
					width={node.width}
					height={node.height}
					rx={isRoot ? 10 : isBranch ? 6 : 4}
					fill={fillColor}
					fillOpacity={bgOpacity}
					stroke={strokeColor}
					strokeWidth={strokeWidth}
					style={{ filter: shadowFilter }}
					className="transition-all duration-200"
				/>
			);
		} else if (nodeShape === "circle") {
			return (
				<rect
					x={node.x}
					y={node.y - node.height / 2}
					width={node.width}
					height={node.height}
					rx={node.height / 2}
					fill={fillColor}
					fillOpacity={bgOpacity}
					stroke={strokeColor}
					strokeWidth={strokeWidth}
					style={{ filter: shadowFilter }}
					className="transition-all duration-200"
				/>
			);
		} else {
			return (
				<>
					<rect
						x={node.x}
						y={node.y - node.height / 2}
						width={node.width}
						height={node.height}
						fill="transparent"
					/>
					<line
						x1={node.x}
						y1={node.y + node.height / 2 - 2}
						x2={node.x + node.width - (isRoot ? 0 : 15)}
						y2={node.y + node.height / 2 - 2}
						stroke={strokeColor}
						strokeWidth={strokeWidth}
						className="transition-all duration-200"
					/>
				</>
			);
		}
	};

	return (
		<>
			<MindmapCardInline
				nodes={nodes}
				paths={paths}
				previewViewBox={previewViewBox}
				activePreset={activePreset}
				nodeShape={nodeShape}
				onExpand={() => setIsExpandedModal(true)}
				onEdit={handleEdit}
				toggleNodeExpanded={toggleNodeExpanded}
				renderNodeShape={renderNodeShape}
			/>

			<MindmapCardModal
				isExpandedModal={isExpandedModal}
				tree={tree}
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
				handleEdit={handleEdit}
				toggleNodeExpanded={toggleNodeExpanded}
				renderNodeShape={renderNodeShape}
				onClose={() => {
					setIsExpandedModal(false);
					setIsStyleMenuOpen(false);
				}}
			/>
		</>
	);
}
