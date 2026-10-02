"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MindmapNode, parseMindmapText, StylePreset, STYLE_PRESETS } from "./mindmap-types";
import { usePreviewLayout } from "./hooks/usePreviewLayout";
import { MindmapPreviewInline } from "./components/MindmapPreviewInline";
import { MindmapPreviewLightbox } from "./components/MindmapPreviewLightbox";
import { createMindmapInBackend } from "@/app/mindmap/hooks/createMindmapBackend";
import { toast } from "sonner";

interface MindmapPreviewProps {
	code: string;
	title?: string;
}

export function MindmapPreview({ code, title = "Mindmap Preview" }: MindmapPreviewProps) {
	const router = useRouter();
	const [isOpen, setIsOpen] = useState(false);
	const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

	// Style states
	const [activePreset, setActivePreset] = useState<StylePreset>(STYLE_PRESETS[0]);
	const [layoutStructure, setLayoutStructure] = useState<string>("mindmap");
	const [layoutSubOption, setLayoutSubOption] = useState<number>(1);
	const [nodeShape, setNodeShape] = useState<"rounded_rect" | "circle" | "underline">("rounded_rect");
	const [isStyleMenuOpen, setIsStyleMenuOpen] = useState(false);

	// Pan & Zoom state for the full-screen modal
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [zoom, setZoom] = useState(1);
	const isDragging = useRef(false);
	const dragStart = useRef({ x: 0, y: 0 });
	const containerRef = useRef<HTMLDivElement>(null);

	// Parse the tree from raw markdown text
	const rootNode = useMemo(() => {
		return parseMindmapText(code);
	}, [code]);

	// Layout parameters
	const nodeWidth = 170;
	const nodeHeight = 36;
	const xGap = 65;
	const yGap = 14;

	// Perform hierarchical layout based on style configuration
	const { nodes, paths, bounds } = usePreviewLayout(
		rootNode,
		collapsedIds,
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

	// Toggle node collapse
	const toggleCollapse = (id: string, e: React.MouseEvent) => {
		e.stopPropagation();
		setCollapsedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	// Open edit mode in the current tab. Persists this preview's tree to the
	// backend only once — repeated clicks (or a race from a fast double-click)
	// reused the same id instead of POSTing a fresh duplicate mindmap row.
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
			const record = await createMindmapInBackend({
				title: rootNode?.topic || "Untitled Mindmap",
				tree: rootNode,
			});
			createdIdRef.current = record.id;
			router.push(`/mindmap?id=${record.id}`);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to open mindmap");
		} finally {
			isCreatingRef.current = false;
		}
	};

	// Fit view in lightbox
	const fitView = () => {
		if (!containerRef.current) return;
		const containerWidth = containerRef.current.clientWidth;
		const containerHeight = containerRef.current.clientHeight;

		const mapWidth = bounds.maxX - bounds.minX;
		const mapHeight = bounds.maxY - bounds.minY;

		const scaleX = (containerWidth - 80) / mapWidth;
		const scaleY = (containerHeight - 80) / mapHeight;
		const newZoom = Math.min(1.5, Math.max(0.4, Math.min(scaleX, scaleY)));

		const centerX = bounds.minX + mapWidth / 2;
		const centerY = bounds.minY + mapHeight / 2;

		setZoom(newZoom);
		setPan({
			x: containerWidth / 2 - centerX * newZoom,
			y: containerHeight / 2 - centerY * newZoom,
		});
	};

	useEffect(() => {
		if (isOpen) {
			setTimeout(fitView, 100);
		}
	}, [isOpen]);

	// Handle dragging in lightbox canvas
	const handleMouseDown = (e: React.MouseEvent) => {
		if ((e.target as HTMLElement).closest(".node-button") || (e.target as HTMLElement).closest(".style-popover-el")) return;
		isDragging.current = true;
		dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
	};

	const handleMouseMove = (e: React.MouseEvent) => {
		if (!isDragging.current) return;
		setPan({
			x: e.clientX - dragStart.current.x,
			y: e.clientY - dragStart.current.y,
		});
	};

	const handleMouseUp = () => {
		isDragging.current = false;
	};

	const handleWheel = (e: React.WheelEvent) => {
		e.preventDefault();
		const zoomFactor = 1.1;
		const newZoom = e.deltaY < 0 ? zoom * zoomFactor : zoom / zoomFactor;
		const nextZoom = Math.min(3, Math.max(0.2, newZoom));

		// Zoom to cursor
		const rect = containerRef.current?.getBoundingClientRect();
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

	return (
		<>
			{/* Inline chat card */}
			<MindmapPreviewInline
				nodes={nodes}
				paths={paths}
				previewViewBox={previewViewBox}
				activePreset={activePreset}
				nodeShape={nodeShape}
				collapsedIds={collapsedIds}
				rootTopic={rootNode?.topic || ""}
				toggleCollapse={toggleCollapse}
				onOpen={() => setIsOpen(true)}
			/>

			{/* Full-screen lightbox modal */}
			{isOpen && (
				<MindmapPreviewLightbox
					nodes={nodes}
					paths={paths}
					activePreset={activePreset}
					setActivePreset={setActivePreset}
					nodeShape={nodeShape}
					setNodeShape={setNodeShape}
					layoutStructure={layoutStructure}
					setLayoutStructure={setLayoutStructure}
					layoutSubOption={layoutSubOption}
					setLayoutSubOption={setLayoutSubOption}
					isStyleMenuOpen={isStyleMenuOpen}
					setIsStyleMenuOpen={setIsStyleMenuOpen}
					rootTopic={rootNode?.topic || ""}
					collapsedIds={collapsedIds}
					toggleCollapse={toggleCollapse}
					pan={pan}
					zoom={zoom}
					setZoom={setZoom}
					containerRef={containerRef}
					handleMouseDown={handleMouseDown}
					handleMouseMove={handleMouseMove}
					handleMouseUp={handleMouseUp}
					handleWheel={handleWheel}
					fitView={fitView}
					handleEdit={handleEdit}
					onClose={() => {
						setIsOpen(false);
						setIsStyleMenuOpen(false);
					}}
					code={code}
				/>
			)}
		</>
	);
}
