"use client";

import React, { useState, useMemo } from "react";
import { X, Edit3, ZoomIn, ZoomOut, RotateCcw, Download } from "lucide-react";
import { PositionedNode, ConnectionPath, StylePreset, parseMindmapText } from "../mindmap-types";
import { getNodeChainIds, parsePathId } from "../mindmap-utils";
import { MindmapPreviewStylePanel } from "./MindmapPreviewStylePanel";
import { renderNodeShape } from "./renderNodeShape";

interface MindmapPreviewLightboxProps {
  nodes: PositionedNode[];
  paths: ConnectionPath[];
  activePreset: StylePreset;
  setActivePreset: (p: StylePreset) => void;
  nodeShape: "rounded_rect" | "circle" | "underline";
  setNodeShape: (s: "rounded_rect" | "circle" | "underline") => void;
  layoutStructure: string;
  setLayoutStructure: (v: string) => void;
  layoutSubOption: number;
  setLayoutSubOption: (v: number) => void;
  isStyleMenuOpen: boolean;
  setIsStyleMenuOpen: (open: boolean) => void;
  rootTopic: string;
  collapsedIds: Set<string>;
  toggleCollapse: (id: string, e: React.MouseEvent) => void;
  pan: { x: number; y: number };
  zoom: number;
  setZoom: (z: number) => void;
  containerRef: React.RefObject<HTMLDivElement>;
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseUp: () => void;
  handleWheel: (e: React.WheelEvent) => void;
  fitView: () => void;
  handleEdit: () => void;
  onClose: () => void;
  code: string;
}

export function MindmapPreviewLightbox({
  nodes,
  paths,
  activePreset,
  setActivePreset,
  nodeShape,
  setNodeShape,
  layoutStructure,
  setLayoutStructure,
  layoutSubOption,
  setLayoutSubOption,
  isStyleMenuOpen,
  setIsStyleMenuOpen,
  rootTopic,
  collapsedIds,
  toggleCollapse,
  pan,
  zoom,
  setZoom,
  containerRef,
  handleMouseDown,
  handleMouseMove,
  handleMouseUp,
  handleWheel,
  fitView,
  handleEdit,
  onClose,
  code,
}: MindmapPreviewLightboxProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const rootNode = useMemo(() => parseMindmapText(code), [code]);

  const focusedNodeIds = useMemo(() => {
    return getNodeChainIds(rootNode, selectedNodeId ? [selectedNodeId] : []);
  }, [rootNode, selectedNodeId]);

  const nodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest(".node-button") && !(e.target as HTMLElement).closest(".mindmap-node-lightbox-g")) {
      setSelectedNodeId(null);
    }
    handleMouseDown(e);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/20 dark:bg-slate-950/85 backdrop-blur-md flex flex-col select-none">
      {/* Top Header Bar */}
      <div className="h-16 border-b border-slate-200 dark:border-slate-800/80 px-6 flex items-center justify-between bg-white/90 dark:bg-slate-900/60 backdrop-blur-md relative z-10">
        <div className="flex items-center gap-3">
          <span className="h-3 w-3 rounded-full bg-emerald-500" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-white truncate max-w-sm">
            {rootTopic || "Mindmap"}
          </h3>
        </div>

        {/* Edit button in the center top */}
        <button
          onClick={handleEdit}
          className="absolute left-1/2 -translate-x-1/2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-9 px-4 rounded-xl shadow-md cursor-pointer flex items-center gap-2 transition-all hover:scale-[1.02]"
        >
          <Edit3 className="w-3.5 h-3.5" />
          Edit in Monica MindMap
        </button>

        {/* Close button */}
        <button
          onClick={onClose}
          className="h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-850 dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Modal Main Canvas Area */}
      <div
        ref={containerRef}
        onMouseDown={onCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className="flex-1 w-full h-full cursor-grab active:cursor-grabbing relative overflow-hidden transition-colors duration-300"
        style={{ backgroundColor: activePreset.canvasBg }}
      >
        {/* Grid Background Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808007_1px,transparent_1px),linear-gradient(to_bottom,#80808007_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none" />

        <svg
          className="absolute inset-0 w-full h-full"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            overflow: "visible",
          }}
        >
          {/* Connection path render */}
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

          {/* Nodes render */}
          {nodes.map((node) => {
            const isRoot = !node.node.floating && node.level === 0;
            const isBranch = node.level === 1;
            const hasChildren = node.node.children && node.node.children.length > 0;
            const isCollapsed = collapsedIds.has(node.id);
            const isDimmed = focusedNodeIds !== null && !focusedNodeIds.has(node.id);

            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y - node.height / 2})`}
                className="mindmap-node-lightbox-g cursor-pointer"
                style={{ opacity: isDimmed ? 0.6 : 1, transition: "opacity 0.25s ease-in-out" }}

                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedNodeId((prev) => (prev === node.id ? null : node.id));
                }}
              >
                {renderNodeShape(node, isRoot, isBranch, activePreset, nodeShape)}


                <foreignObject
                  x={4}
                  y={2}
                  width={node.width - 12}
                  height={node.height - 4}
                >
                  <div
                    className={`w-full h-full flex items-center text-[10.5px] leading-snug select-none ${
                      isRoot
                        ? "justify-center text-center font-bold text-white"
                        : isBranch
                        ? "justify-center text-center font-semibold text-slate-200"
                        : `justify-start text-left font-medium ${activePreset.textClass}`
                    }`}
                    style={{
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {node.topic}
                  </div>
                </foreignObject>

                {hasChildren && (isRoot || isBranch) && (
                  <circle
                    cx={node.direction === "left" ? 0 : node.width}
                    cy={node.height / 2}
                    r={6}
                    fill={isCollapsed ? node.branchColor : "#ffffff"}
                    stroke={node.branchColor}
                    strokeWidth={2}
                    className="node-button cursor-pointer"
                    onClick={(e) => toggleCollapse(node.id, e)}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Bottom Floating Control Bar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-white/95 dark:bg-slate-900/85 backdrop-blur-md border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-2xl flex items-center gap-4.5 shadow-xl z-20">

        {/* Style Menu Popover */}
        <MindmapPreviewStylePanel
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

        {/* Zoom controls */}
        <div className="flex items-center gap-1 border-r border-slate-200 dark:border-slate-800 pr-4">
          <button
            onClick={() => setZoom(Math.max(0.3, zoom - 0.1))}
            className="h-7 w-7 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-300 w-11 text-center select-none">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(Math.min(3, zoom + 0.1))}
            className="h-7 w-7 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={fitView}
            className="h-7 w-7 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer ml-1"
            title="Reset View / Fit Canvas"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Export button */}
        <button
          onClick={() => {
            const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${rootTopic || "mindmap"}.md`;
            link.click();
            URL.revokeObjectURL(url);
          }}
          className="h-7 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white text-[11px] font-bold rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors"
        >
          <Download className="w-3 h-3" />
          Export MindMap
        </button>
      </div>
    </div>
  );
}
