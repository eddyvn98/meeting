"use client";

import React from "react";
import { PositionedNode, ConnectionPath, StylePreset } from "../mindmap-types";
import { renderNodeShape } from "./renderNodeShape";

interface MindmapPreviewInlineProps {
  nodes: PositionedNode[];
  paths: ConnectionPath[];
  previewViewBox: string;
  activePreset: StylePreset;
  nodeShape: "rounded_rect" | "circle" | "underline";
  collapsedIds: Set<string>;
  rootTopic: string;
  toggleCollapse: (id: string, e: React.MouseEvent) => void;
  onOpen: () => void;
}

export function MindmapPreviewInline({
  nodes,
  paths,
  previewViewBox,
  activePreset,
  nodeShape,
  collapsedIds,
  rootTopic,
  toggleCollapse,
  onOpen,
}: MindmapPreviewInlineProps) {
  return (
    <div
      onClick={onOpen}
      className="w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-md hover:shadow-lg transition-all duration-200 cursor-pointer overflow-hidden group select-none relative"
    >
      <div className="flex items-center justify-between mb-3 border-b border-slate-100 dark:border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate max-w-[280px]">
            {rootTopic || "Mindmap"}
          </h4>
        </div>
        <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-semibold px-2 py-0.5 rounded-md uppercase tracking-wider group-hover:bg-emerald-55 group-hover:text-emerald-600 dark:group-hover:bg-emerald-950/30 dark:group-hover:text-emerald-400 transition-colors">
          Click to Expand
        </span>
      </div>

      <div
        className="w-full aspect-[16/10] rounded-xl relative overflow-hidden flex items-center justify-center border border-slate-100/60 dark:border-slate-900/60 transition-all duration-300"
        style={{ backgroundColor: activePreset.canvasBg }}
      >
        <svg
          viewBox={previewViewBox}
          className="w-full h-full max-h-[260px] p-2"
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
            const isCollapsed = collapsedIds.has(node.id);

            return (
              <g key={node.id} transform={`translate(${node.x}, ${node.y - node.height / 2})`}>
                {renderNodeShape(node, isRoot, isBranch, activePreset, nodeShape)}

                <foreignObject
                  x={4}
                  y={2}
                  width={node.width - 12}
                  height={node.height - 4}
                >
                  <div
                    className={`w-full h-full flex items-center text-[10px] leading-tight select-none ${
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
                    r={5}
                    fill={isCollapsed ? node.branchColor : "#ffffff"}
                    stroke={node.branchColor}
                    strokeWidth={1.5}
                    className="node-button cursor-pointer"
                    onClick={(e) => toggleCollapse(node.id, e)}
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
