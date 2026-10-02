import {
  createBlockId,
  createComputedTransform,
  type BlockStyle,
  type CanvasBlock,
  type MapLayoutSettings,
} from "../../types/block";
import { createConnectorId, type AnchorSide, type CanvasConnector } from "../../types/connector";

export interface FlowchartTemplateIdFactory {
  blockId?: (key: string, index: number) => string;
  connectorId?: (fromBlockId: string, toBlockId: string, index: number) => string;
}

export interface FlowchartTemplateResult {
  blocks: Array<CanvasBlock & { mapId: string }>;
  connectors: CanvasConnector[];
  rootId: string;
}

const YES_COLOR = "#16a34a";
const NO_COLOR = "#dc2626";

const pill = (bg: string): BlockStyle => ({ shapeKind: "pill", backgroundColor: bg, borderColor: "#1e293b", borderWidth: 1.5, textColor: "#0f172a" });
const rect = (): BlockStyle => ({ shapeKind: "rounded", backgroundColor: "#eef2f7", borderColor: "#1e293b", borderWidth: 1.5, textColor: "#0f172a" });
const diamond = (): BlockStyle => ({ shapeKind: "diamond", backgroundColor: "#fef3c7", borderColor: "#1e293b", borderWidth: 1.5, textColor: "#0f172a" });

interface NodeSpec {
  key: string;
  label: string;
  style: BlockStyle;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface EdgeSpec {
  from: string;
  fromSide: AnchorSide;
  to: string;
  toSide: AnchorSide;
  label?: string;
  labelColor?: string;
}

// A login flow: two decision forks (each with a colored Yes/No branch) and
// two loop-backs (retry the credentials check; register then return to
// login) - the shape a "Flowchart" template needs to actually demonstrate,
// unlike a single straight-line decision. Matches the reference tool's own
// sample flow (see larksuite-board-observations).
const NODES: NodeSpec[] = [
  { key: "start", label: "Open app", style: pill("#ede9fe"), x: 40, y: 170, w: 150, h: 64 },
  { key: "login", label: "Log in", style: rect(), x: 280, y: 167, w: 170, h: 70 },
  { key: "hasAccount", label: "Have account already?", style: diamond(), x: 520, y: 152, w: 170, h: 100 },
  { key: "credentials", label: "Enter account name and password", style: rect(), x: 760, y: 167, w: 170, h: 70 },
  { key: "correct", label: "Correct?", style: diamond(), x: 1000, y: 152, w: 170, h: 100 },
  { key: "home", label: "Enter homepage", style: pill("#ede9fe"), x: 1240, y: 170, w: 150, h: 64 },
  { key: "register", label: "Enter registration information", style: rect(), x: 520, y: 397, w: 170, h: 70 },
  { key: "registered", label: "Registered?", style: diamond(), x: 520, y: 612, w: 170, h: 100 },
  { key: "forgot", label: "Forgot password", style: rect(), x: 1000, y: 397, w: 170, h: 70 },
  { key: "reset", label: "Reset password", style: rect(), x: 1000, y: 612, w: 170, h: 70 },
];

const EDGES: EdgeSpec[] = [
  { from: "start", fromSide: "right", to: "login", toSide: "left" },
  { from: "login", fromSide: "right", to: "hasAccount", toSide: "left" },
  { from: "hasAccount", fromSide: "right", to: "credentials", toSide: "left", label: "Yes", labelColor: YES_COLOR },
  { from: "hasAccount", fromSide: "bottom", to: "register", toSide: "top", label: "No", labelColor: NO_COLOR },
  { from: "register", fromSide: "bottom", to: "registered", toSide: "top" },
  { from: "registered", fromSide: "left", to: "register", toSide: "left", label: "No", labelColor: NO_COLOR },
  { from: "registered", fromSide: "bottom", to: "login", toSide: "bottom", label: "Yes", labelColor: YES_COLOR },
  { from: "credentials", fromSide: "right", to: "correct", toSide: "left" },
  { from: "correct", fromSide: "right", to: "home", toSide: "left", label: "Yes", labelColor: YES_COLOR },
  { from: "credentials", fromSide: "right", to: "forgot", toSide: "left" },
  { from: "forgot", fromSide: "bottom", to: "reset", toSide: "top" },
  { from: "correct", fromSide: "top", to: "credentials", toSide: "top", label: "No", labelColor: NO_COLOR },
];

/**
 * Builds the Flowchart template's starter content directly as free-form
 * blocks + explicit connectors, bypassing buildTreeTemplateBlocks - a login
 * flow's decision retries and its "register, then return to login" loop are
 * not tree-shaped (a node here can have more than one incoming wire), which
 * a single-parent tree walker can't express. Mirrors buildSwimlaneTemplateBlocks'
 * own reason for a dedicated builder.
 */
export function buildFlowchartTemplateBlocks(
  mapId: string,
  origin: { x: number; y: number },
  layout: MapLayoutSettings,
  ids: FlowchartTemplateIdFactory | undefined,
  now: number,
): FlowchartTemplateResult {
  const idByKey = new Map<string, string>();
  const blocks: Array<CanvasBlock & { mapId: string }> = NODES.map((node, index) => {
    const id = ids?.blockId?.(node.key, index) ?? createBlockId();
    idByKey.set(node.key, id);
    const block: CanvasBlock<"text"> & { mapId: string } = {
      id,
      mapId,
      type: "text",
      transform: createComputedTransform({ w: node.w, h: node.h, x: origin.x + node.x, y: origin.y + node.y, rotation: 0, zIndex: index }),
      data: { markdown: node.label },
      style: node.style,
      createdAt: now,
      updatedAt: now,
    };
    if (index === 0) block.mapLayout = layout;
    return block;
  });

  const connectors: CanvasConnector[] = EDGES.map((edge, index) => {
    const fromBlockId = idByKey.get(edge.from)!;
    const toBlockId = idByKey.get(edge.to)!;
    const id = ids?.connectorId?.(fromBlockId, toBlockId, index) ?? createConnectorId();
    return {
      id,
      fromBlockId,
      fromSide: edge.fromSide,
      toBlockId,
      toSide: edge.toSide,
      lineType: "orthogonal",
      arrowEnd: true,
      strokeColor: "#1e293b",
      ...(edge.label ? { label: edge.label, labelColor: edge.labelColor } : {}),
    };
  });

  return { blocks, connectors, rootId: idByKey.get("start")! };
}
