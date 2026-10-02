"use client";

import React from "react";
import { PositionedNode, StylePreset } from "../mindmap-types";

export function renderNodeShape(
  node: PositionedNode,
  isRoot: boolean,
  isBranch: boolean,
  activePreset: StylePreset,
  nodeShape: "rounded_rect" | "circle" | "underline"
) {
  const customBgColor = node.node.style?.bgColor ?? node.node.style?.color;
  const customBorderColor = node.node.style?.borderColor ?? node.node.style?.color;

  const strokeColor = customBorderColor ?? (isRoot ? activePreset.rootBorder : node.branchColor);
  const strokeWidth = isRoot ? 2 : 1.8;
  const fillColor = isRoot
    ? (customBgColor ?? activePreset.rootBg)
    : (customBgColor ?? (isBranch ? `${node.branchColor}18` : `${node.branchColor}08`));

  const shadowFilter = "drop-shadow(0 4px 10px rgba(0,0,0,0.15))";
  const bgOpacity = node.node.style?.bgOpacity !== undefined ? node.node.style.bgOpacity / 100 : undefined;

  if (nodeShape === "rounded_rect") {
    return (
      <rect
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
    // underline style
    return (
      <>
        <rect
          width={node.width}
          height={node.height}
          fill="transparent"
        />
        <line
          x1={0}
          y1={node.height - 2}
          x2={node.width - (isRoot ? 0 : 15)}
          y2={node.height - 2}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          className="transition-all duration-200"
        />
      </>
    );
  }
}
