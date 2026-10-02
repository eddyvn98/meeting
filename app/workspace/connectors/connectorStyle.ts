import type { BlockId, CanvasBlock } from "../types/block";
import type { CanvasConnector } from "../types/connector";
import { WORKSPACE_CONNECTOR_PALETTES } from "./workspaceConnectorPalettes";

export { WORKSPACE_CONNECTOR_PALETTES } from "./workspaceConnectorPalettes";

export type ConnectorLinePattern = "solid" | "dashed" | "dotted";
export type ConnectorArrowStyle = "none" | "arrow" | "dot" | "slash";
export type WorkspaceConnectorLineType = NonNullable<CanvasConnector["lineType"]>;
export type WorkspaceConnectorPaletteId = string;

export const DEFAULT_WORKSPACE_CONNECTOR_LINE_TYPE: WorkspaceConnectorLineType = "curved";

export function getWorkspaceConnectorPalette(id: WorkspaceConnectorPaletteId) {
  return WORKSPACE_CONNECTOR_PALETTES.find((palette) => palette.id === id)
    ?? WORKSPACE_CONNECTOR_PALETTES[0];
}

export function applyWorkspaceMapStyle(
  connectors: Record<string, CanvasConnector>,
  lineType: WorkspaceConnectorLineType,
  paletteId: WorkspaceConnectorPaletteId,
): Record<string, CanvasConnector> {
  const colors = getWorkspaceConnectorPalette(paletteId).colors;
  return Object.fromEntries(
    Object.values(connectors).map((connector, index) => [connector.id, {
      ...connector,
      lineType,
      strokeColor: colors[index % colors.length],
    }]),
  );
}

function mapDepth(blocks: Record<BlockId, CanvasBlock>, blockId: BlockId, rootId: BlockId): number {
  let depth = 0;
  let current = blocks[blockId];
  while (current && current.id !== rootId && current.parentId && depth < 1000) {
    depth += 1;
    current = blocks[current.parentId];
  }
  return depth;
}

function belongsToMap(blocks: Record<BlockId, CanvasBlock>, blockId: BlockId, rootId: BlockId): boolean {
  let current = blocks[blockId];
  for (let guard = 0; current && guard < 1000; guard += 1) {
    if (current.id === rootId) return true;
    if (!current.parentId) return false;
    current = blocks[current.parentId];
  }
  return false;
}

/** Applies connector colors by the source block's level in one map. */
export function applyWorkspaceMapStyleByDepth(
  connectors: Record<string, CanvasConnector>,
  blocks: Record<BlockId, CanvasBlock>,
  rootId: BlockId,
  lineType: WorkspaceConnectorLineType,
  paletteId: WorkspaceConnectorPaletteId,
): Record<string, CanvasConnector> {
  const colors = getWorkspaceConnectorPalette(paletteId).colors;
  return Object.fromEntries(
    Object.values(connectors).map((connector) => {
      if (!belongsToMap(blocks, connector.fromBlockId, rootId) || !belongsToMap(blocks, connector.toBlockId, rootId)) {
        return [connector.id, connector];
      }
      // Structural node fills/borders are assigned by the destination level,
      // so the incoming connector must use the same level color. Using the
      // source level makes every edge into a deeper node one palette step late.
      const depth = Math.max(mapDepth(blocks, connector.toBlockId, rootId), 1) - 1;
      return [connector.id, {
        ...connector,
        lineType,
        strokeColor: colors[depth % colors.length],
      }];
    }),
  );
}

/**
 * A freeform shape has no per-map line-style setting of its own (see
 * useTreeAutoArrange/mapRoot.ts's mapLayout, which only lives on tree-root
 * blocks) - currentMapLayout falls through to the global treeConnectorLineType
 * constant for it, which never reflects what the user actually did in THIS
 * diagram. What the user actually did is visible on the shape's own existing
 * connectors (e.g. a chain of quick-added siblings all drawn orthogonal) -
 * matching whichever style already touches this block keeps a new
 * quick-add connector/preview consistent with its neighbors instead of
 * silently reverting to the unrelated global default the moment a shape has
 * no map of its own.
 */
export function resolveShapeConnectorLineType(
  connectors: Record<string, CanvasConnector>,
  blockId: string,
  fallback: WorkspaceConnectorLineType,
): WorkspaceConnectorLineType {
  const existing = Object.values(connectors).find(
    (connector) => connector.fromBlockId === blockId || connector.toBlockId === blockId,
  );
  return existing?.lineType ?? fallback;
}

export function withWorkspaceConnectorDefaults(
  connector: CanvasConnector,
  lineType: WorkspaceConnectorLineType,
  paletteId: WorkspaceConnectorPaletteId,
  index: number,
): CanvasConnector {
  const colors = getWorkspaceConnectorPalette(paletteId).colors;
  return {
    ...connector,
    lineType: connector.lineType ?? lineType,
    strokeColor: connector.strokeColor ?? colors[index % colors.length],
  };
}

/** Runtime additions are kept in the connector record without changing the public CanvasConnector shape. */
export type CompatibleCanvasConnector = CanvasConnector & {
  linePattern?: ConnectorLinePattern;
  lineOpacity?: number;
  lineJump?: boolean;
  arrowStartStyle?: ConnectorArrowStyle;
  arrowEndStyle?: ConnectorArrowStyle;
};

export interface ConnectorVisualStyle {
  lineType: NonNullable<CanvasConnector["lineType"]>;
  linePattern: ConnectorLinePattern;
  lineWidth: number;
  lineOpacity: number;
  arrowStart: ConnectorArrowStyle;
  arrowEnd: ConnectorArrowStyle;
  lineJump: boolean;
  color?: string;
}

const ARROW_STYLES: ConnectorArrowStyle[] = ["none", "arrow", "dot", "slash"];

function normalizeArrow(value: unknown, fallback: ConnectorArrowStyle): ConnectorArrowStyle {
  return typeof value === "string" && ARROW_STYLES.includes(value as ConnectorArrowStyle)
    ? value as ConnectorArrowStyle
    : fallback;
}

export function getConnectorVisualStyle(connector: CanvasConnector): ConnectorVisualStyle {
  const compatible = connector as CompatibleCanvasConnector & {
    arrowStart?: boolean | ConnectorArrowStyle;
    arrowEnd?: boolean | ConnectorArrowStyle;
  };
  // Legacy default has no arrowheads on mindmap connectors (arrowEnd stays
  // undefined unless the map is flowchart/swimlane — see
  // usePageRelationships.ts's activeRelationshipStyle default), so Workspace
  // must default to "none" the same way instead of always drawing an arrow.
  const startFallback = compatible.arrowStart === true ? "arrow" : "none";
  const endFallback = compatible.arrowEnd === true ? "arrow" : "none";
  const opacity = Number(compatible.lineOpacity);

  return {
    lineType: connector.lineType ?? "straight",
    linePattern: compatible.linePattern ?? (connector.dashed ? "dashed" : "solid"),
    lineWidth: connector.strokeWidth ?? 2,
    lineOpacity: Number.isFinite(opacity) ? Math.min(100, Math.max(10, opacity)) : 100,
    arrowStart: normalizeArrow(compatible.arrowStartStyle ?? compatible.arrowStart, startFallback),
    arrowEnd: normalizeArrow(compatible.arrowEndStyle ?? compatible.arrowEnd, endFallback),
    lineJump: compatible.lineJump === true,
    color: connector.strokeColor,
  };
}

export type ConnectorStylePatch = Partial<CanvasConnector> & {
  linePattern?: ConnectorLinePattern;
  lineOpacity?: number;
  arrowStartStyle?: ConnectorArrowStyle;
  arrowEndStyle?: ConnectorArrowStyle;
  lineJump?: boolean;
};

export function stylePatchForPattern(pattern: ConnectorLinePattern): ConnectorStylePatch {
  return { linePattern: pattern, dashed: pattern === "dashed" };
}

export function stylePatchForArrow(end: "start" | "end", style: ConnectorArrowStyle): ConnectorStylePatch {
  return end === "start"
    ? { arrowStart: style !== "none", arrowStartStyle: style }
    : { arrowEnd: style !== "none", arrowEndStyle: style };
}

export function lineDashArray(pattern: ConnectorLinePattern, strokeWidth: number = 2): string | undefined {
  if (pattern === "dashed") return `${strokeWidth * 3} ${strokeWidth * 2}`;
  if (pattern === "dotted") return strokeWidth === 2 ? "1 5" : `${Math.max(1, Math.round(strokeWidth * 0.8))} ${strokeWidth * 2.5}`;
  return undefined;
}
