import { MindmapNode, StylePreset, PositionedNode, ConnectionPath } from "../../mindmap-types";
import { layoutOrgChartCore, layoutMindmapCore, layoutLogicalCore } from "./sharedTreeLayouts";
import {
  layoutCatalog,
  layoutTimeline,
  layoutVerticalTimeline,
  layoutFishbone,
  layoutFlowchart,
  layoutSwimlane,
} from "./newLayouts";

export interface PreviewLayoutOptions {
  tree: MindmapNode | null;
  /** undefined = card mode (uses node.expanded); defined = preview mode (uses Set lookup) */
  collapsedIds?: Set<string>;
  activePreset: StylePreset;
  layoutStructure: string;
  nodeShape: "rounded_rect" | "circle" | "underline";
  nodeWidth: number;
  nodeHeight: number;
  xGap: number;
  yGap: number;
  layoutSubOption?: number;
}

export interface PreviewLayoutResult {
  nodes: PositionedNode[];
  paths: ConnectionPath[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export function computeLayoutBounds(
  positioned: PositionedNode[]
): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  positioned.forEach((n) => {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x + n.width);
    minY = Math.min(minY, n.y - n.height / 2);
    maxY = Math.max(maxY, n.y + n.height / 2);
  });
  if (minX === Infinity) { minX = 0; maxX = 500; minY = 0; maxY = 300; }
  return { minX, maxX, minY, maxY };
}

export function runPreviewDispatch(options: PreviewLayoutOptions): PreviewLayoutResult {
  const {
    tree, collapsedIds, activePreset, layoutStructure,
    nodeWidth, nodeHeight, xGap, yGap, layoutSubOption,
  } = options;

  if (!tree) {
    return { nodes: [], paths: [], bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } };
  }

  const subOpt = layoutSubOption || 1;
  const isCollapsed = collapsedIds
    ? (n: MindmapNode) => collapsedIds.has(n.id)
    : (n: MindmapNode) => n.expanded === false;

  let result: { positioned: PositionedNode[]; connections: ConnectionPath[] };

  if (layoutStructure === "org_chart") {
    result = layoutOrgChartCore(tree, isCollapsed, activePreset, nodeWidth, nodeHeight, xGap, yGap, subOpt);
  } else if (layoutStructure === "mindmap") {
    result = layoutMindmapCore(tree, isCollapsed, activePreset, nodeWidth, nodeHeight, xGap, yGap, subOpt);
  } else if (layoutStructure === "catalog") {
    result = layoutCatalog(tree, activePreset, subOpt, nodeWidth, nodeHeight, xGap, yGap, collapsedIds);
  } else if (layoutStructure === "timeline") {
    result = layoutTimeline(tree, activePreset, subOpt, nodeWidth, nodeHeight, xGap, yGap, collapsedIds);
  } else if (layoutStructure === "vertical_timeline") {
    result = layoutVerticalTimeline(tree, activePreset, subOpt, nodeWidth, nodeHeight, xGap, yGap, collapsedIds);
  } else if (layoutStructure === "fishbone") {
    result = layoutFishbone(tree, activePreset, subOpt, nodeWidth, nodeHeight, xGap, yGap, collapsedIds);
  } else if (layoutStructure === "flowchart") {
    result = layoutFlowchart(tree, activePreset, subOpt, nodeWidth, nodeHeight, xGap, yGap, collapsedIds);
  } else if (layoutStructure === "swimlane") {
    result = layoutSwimlane(tree, activePreset, subOpt, nodeWidth, nodeHeight, xGap, yGap, collapsedIds);
  } else {
    // logical, skeleton, and other tree layouts
    result = layoutLogicalCore(tree, isCollapsed, activePreset, layoutStructure, nodeWidth, nodeHeight, xGap, yGap, subOpt);
  }

  return {
    nodes: result.positioned,
    paths: result.connections,
    bounds: computeLayoutBounds(result.positioned),
  };
}
