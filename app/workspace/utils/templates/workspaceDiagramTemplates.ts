import {
  createBlockId,
  createComputedTransform,
  type BlockStyle,
  type BlockType,
  type CanvasBlock,
  type MapLayoutSettings,
  type Transform,
} from "../../types/block";
import { createConnectorId, type CanvasConnector } from "../../types/connector";
import { buildSwimlaneTemplateBlocks } from "./workspaceSwimlaneTemplate";
import { buildFlowchartTemplateBlocks } from "./workspaceFlowchartTemplate";

export const WORKSPACE_DIAGRAM_TEMPLATE_KINDS = [
  "workflow",
  // Same starter content as "workflow"; the separate name exists because the
  // layout picker offers a "Flowchart" family and its create-kind id has to
  // resolve to a template.
  "flowchart",
  // A real table (lane grid) + freeform step blocks, matching Lark's two
  // swimlane templates - see buildSwimlaneTemplateBlocks.
  "swimlane-horizontal",
  "swimlane-vertical",
  "table",
  "logical-right",
  "catalog",
  "timeline",
  "fishbone",
  "default",
] as const;

export type WorkspaceDiagramTemplateKind = (typeof WORKSPACE_DIAGRAM_TEMPLATE_KINDS)[number];

/** Template blocks carry first-class map membership for free-form diagrams. */
export type WorkspaceTemplateBlock<T extends BlockType = BlockType> = CanvasBlock<T> & { mapId: string };

export interface WorkspaceTemplateIdFactory {
  mapId?: () => string;
  blockId?: (key: string, index: number) => string;
  connectorId?: (fromBlockId: string, toBlockId: string, index: number) => string;
}

export interface CreateWorkspaceDiagramTemplateOptions {
  mapId?: string;
  idFactory?: WorkspaceTemplateIdFactory;
  now?: number;
  origin?: { x: number; y: number };
  /** Direction/line/palette choices the user already made in the layout picker
   *  before confirming creation - override layoutFor(kind)'s canonical defaults. */
  layoutOverrides?: Partial<MapLayoutSettings>;
}

export interface WorkspaceDiagramTemplate {
  kind: WorkspaceDiagramTemplateKind;
  mapId: string;
  rootId: string;
  blocks: WorkspaceTemplateBlock[];
  connectors: CanvasConnector[];
  mapLayout: MapLayoutSettings;
}

export interface TemplateNode {
  label: string;
  style?: BlockStyle;
  description?: string;
  connector?: { label?: string; dashed?: boolean };
  children?: TemplateNode[];
}

interface TableTemplate {
  label: string;
  style: BlockStyle;
  rows: number;
  cols: number;
  cells: string[][];
}

type TemplateShape = TemplateNode | TableTemplate;

const TEXT_SIZE = { w: 170, h: 36 };
const TABLE_SIZE = { w: 480, h: 300 };

const textStyle = (shapeKind: BlockStyle["shapeKind"], backgroundColor: string, borderColor = "#cbd5e1"): BlockStyle => ({
  shapeKind,
  backgroundColor,
  borderColor,
  borderWidth: 1.5,
  textColor: "#0f172a",
});

const node = (label: string, style?: BlockStyle, children?: TemplateNode[], connector?: TemplateNode["connector"]): TemplateNode => ({
  label,
  style: style ? {
    ...style,
    paletteManagedFields: {
      ...(style.backgroundColor !== undefined ? { backgroundColor: true } : {}),
      ...(style.backgroundOpacity !== undefined ? { backgroundOpacity: true } : {}),
      ...(style.borderColor !== undefined ? { borderColor: true } : {}),
      ...(style.textColor !== undefined ? { textColor: true } : {}),
    },
  } : style,
  children,
  connector,
});

function tableTemplate(): TableTemplate {
  return {
    label: "Table",
    style: textStyle("rounded", "#ffffff", "#94a3b8"),
    rows: 4,
    cols: 3,
    cells: [
      ["Item", "Owner", "Status"],
      ["Workstream 1", "Team A", "Planned"],
      ["Workstream 2", "Team B", "In progress"],
      ["Workstream 3", "Team C", "Done"],
    ],
  };
}

function defaultTemplate(): TemplateNode {
  // Leave colors to the selected map palette. Explicit colors here would look
  // like user overrides and would prevent a newly selected palette from
  // recoloring the generated nodes.
  const rootStyle: BlockStyle = { shapeKind: "rounded", borderWidth: 1.5 };
  const branchStyle: BlockStyle = { shapeKind: "rounded", borderWidth: 1.5 };
  return node("New Map", rootStyle, [
    node("Main Idea 1", branchStyle),
    node("Main Idea 2", branchStyle),
  ]);
}

function normalizeKind(kind: string | undefined): WorkspaceDiagramTemplateKind {
  return (WORKSPACE_DIAGRAM_TEMPLATE_KINDS as readonly string[]).includes(kind ?? "")
    ? kind as WorkspaceDiagramTemplateKind
    : "default";
}

function layoutFor(kind: WorkspaceDiagramTemplateKind): MapLayoutSettings {
  const base: MapLayoutSettings = {
    family: "hierarchy",
    direction: "right",
    growthMode: "one-side",
    connectorLineType: "curved",
    connectorPaletteId: "default",
    timelineBranchMode: "auto",
    timelineDescendantStyle: "tree",
    catalogDescendantStyle: "tree",
  };
  // Flowchart and swimlane are real families now. Both used to be mapped to
  // orgchart, which is why a swimlane came out as a plain org-chart with no
  // lanes and its wires left the wrong edges (orgchart ignores `direction`
  // while the connector-side picker reads it).
  if (kind === "workflow" || kind === "flowchart") {
    return { ...base, family: "flowchart", direction: "down", connectorLineType: "orthogonal" };
  }
  // Free-form, like flowchart: a real table drawn behind + freeform steps,
  // built directly by buildSwimlaneTemplateBlocks - `direction` here only
  // records the orientation for the toolbar's own bookkeeping.
  if (kind === "swimlane-horizontal") {
    return { ...base, family: "swimlane", direction: "right", connectorLineType: "orthogonal" };
  }
  if (kind === "swimlane-vertical") {
    return { ...base, family: "swimlane", direction: "down", connectorLineType: "orthogonal" };
  }
  // Legacy catalog/Treeview creation starts from the canonical right-growing
  // orientation. The four-way catalog mirror treats "down" as an x+y flip,
  // which puts a fresh map's first branches above and left of its root.
  if (kind === "catalog") return { ...base, family: "treeview", direction: "right" };
  // Legacy createDiagramTemplate only sets the timeline family; its default
  // auto mode resolves to one-side for this three-node starter tree.
  if (kind === "timeline") return { ...base, family: "timeline", direction: "right" };
  if (kind === "fishbone") return { ...base, family: "fishbone", direction: "right", connectorLineType: "orthogonal" };
  return base;
}

function shapeFor(kind: WorkspaceDiagramTemplateKind): TemplateShape {
  if (kind === "table") return tableTemplate();
  // Legacy map creation seeds a small, generic three-node map regardless of
  // the selected visible layout. The layout choice changes arrangement and
  // connector styling; it does not inject demo content into the new map.
  return defaultTemplate();
}

function transformFor(index: number, depth: number, direction: MapLayoutSettings["direction"], size: typeof TEXT_SIZE, origin: { x: number; y: number }): Transform {
  const lane = index * 96;
  const depthOffset = depth * 260;
  const x = direction === "left" ? origin.x - depthOffset : direction === "right" ? origin.x + depthOffset : origin.x + lane;
  const y = direction === "up" ? origin.y - depth * 110 : direction === "down" ? origin.y + depth * 110 : origin.y + lane;
  return { ...size, x, y, rotation: 0, zIndex: index };
}

export interface BuildTreeTemplateBlocksOptions {
  mapId: string;
  layout: MapLayoutSettings;
  idFactory?: WorkspaceTemplateIdFactory;
  now?: number;
  origin?: { x: number; y: number };
}

export interface BuiltTreeTemplateBlocks {
  rootId: string;
  blocks: WorkspaceTemplateBlock[];
  connectors: CanvasConnector[];
}

/** Walks a TemplateNode tree into text blocks + connectors, one per node,
 *  laid out by transformFor. Shared by every fixed-shape template
 *  (createWorkspaceDiagramTemplate below) and any caller building a
 *  one-off tree it did not get from shapeFor — e.g. an AI-generated
 *  mindmap outline (see lib/meeting/ai/generateMeetingMindmap.ts). */
export function buildTreeTemplateBlocks(root: TemplateNode, options: BuildTreeTemplateBlocksOptions): BuiltTreeTemplateBlocks {
  const { mapId, layout, idFactory: ids, now = Date.now(), origin = { x: 120, y: 120 } } = options;
  const blocks: WorkspaceTemplateBlock[] = [];
  const connectors: CanvasConnector[] = [];
  let blockIndex = 0;
  let connectorIndex = 0;

  const addNode = (current: TemplateNode, parentId: string | undefined, depth: number): string => {
    const index = blockIndex++;
    const id = ids?.blockId?.(`block-${index}`, index) ?? createBlockId();
    const transform = transformFor(index, depth, layout.direction, TEXT_SIZE, origin);
    const block: WorkspaceTemplateBlock<"text"> = {
      id, mapId, type: "text", transform: createComputedTransform(transform), data: { markdown: current.label },
      style: current.style ?? {}, description: current.description, parentId, createdAt: now, updatedAt: now,
    };
    blocks.push(block);
    if (parentId) {
      const connectorId = ids?.connectorId?.(parentId, id, connectorIndex) ?? createConnectorId();
      // Hierarchy, Treeview, Timeline, and Fishbone inherit the legacy
      // mindmap default: structural connectors have no arrowheads. Flowchart
      // and swimlane are not exposed by the Workspace map-layout picker, so
      // their hidden templates must not change the visible map contract.
      connectors.push({ id: connectorId, fromBlockId: parentId, toBlockId: id, label: current.connector?.label, dashed: current.connector?.dashed, lineType: layout.connectorLineType });
      connectorIndex += 1;
    }
    for (const child of current.children ?? []) addNode(child, id, depth + 1);
    return id;
  };

  const rootId = addNode(root, undefined, 0);
  return { rootId, blocks, connectors };
}

export function createWorkspaceDiagramTemplate(kind?: string, options: CreateWorkspaceDiagramTemplateOptions = {}): WorkspaceDiagramTemplate {
  const normalizedKind = normalizeKind(kind);
  const layout = { ...layoutFor(normalizedKind), ...options.layoutOverrides };
  const ids = options.idFactory;
  const mapId = options.mapId ?? ids?.mapId?.() ?? createBlockId();
  const now = options.now ?? Date.now();
  const origin = options.origin ?? { x: 120, y: 120 };

  if (normalizedKind === "swimlane-horizontal" || normalizedKind === "swimlane-vertical") {
    const built = buildSwimlaneTemplateBlocks(
      normalizedKind === "swimlane-horizontal" ? "horizontal" : "vertical",
      mapId, origin, ids, now,
    );
    const root = built.blocks.find((block) => block.id === built.rootId);
    if (root) root.mapLayout = layout;
    return { kind: normalizedKind, mapId, rootId: built.rootId, blocks: built.blocks, connectors: built.connectors, mapLayout: layout };
  }

  if (normalizedKind === "workflow" || normalizedKind === "flowchart") {
    const built = buildFlowchartTemplateBlocks(mapId, origin, layout, ids, now);
    return { kind: normalizedKind, mapId, rootId: built.rootId, blocks: built.blocks, connectors: built.connectors, mapLayout: layout };
  }

  const shape = shapeFor(normalizedKind);
  let rootId: string;
  let blocks: WorkspaceTemplateBlock[];
  let connectors: CanvasConnector[];
  if ("rows" in shape) {
    rootId = ids?.blockId?.("block-0", 0) ?? createBlockId();
    const tableBlock: WorkspaceTemplateBlock<"table"> = {
      id: rootId, mapId, type: "table", transform: createComputedTransform({ ...TABLE_SIZE, ...origin, rotation: 0, zIndex: 0 }),
      data: { rows: shape.rows, cols: shape.cols, cells: shape.cells, headerRow: true }, style: shape.style, parentId: undefined,
      createdAt: now, updatedAt: now,
    };
    blocks = [tableBlock];
    connectors = [];
  } else {
    const built = buildTreeTemplateBlocks(shape, { mapId, layout, idFactory: ids, now, origin });
    rootId = built.rootId;
    blocks = built.blocks;
    connectors = built.connectors;
  }

  const root = blocks.find((block) => block.id === rootId);
  if (root) root.mapLayout = layout;
  return { kind: normalizedKind, mapId, rootId, blocks, connectors, mapLayout: layout };
}

export const createWorkspaceTemplate = createWorkspaceDiagramTemplate;
