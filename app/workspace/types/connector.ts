import type { BlockId } from "./block";
import { createWorkspaceId } from "../utils/workspaceId";

export type AnchorSide = "top" | "right" | "bottom" | "left" | "center";

export type ConnectorId = string;

export interface CanvasConnector {
  id: ConnectorId;
  fromBlockId: BlockId;
  fromSide?: AnchorSide;
  toBlockId: BlockId;
  toSide?: AnchorSide;
  label?: string;
  /** Label-only overrides; unset falls back to the connector's own stroke color / the default 11px size. */
  labelColor?: string;
  labelFontSize?: number;
  labelBold?: boolean;
  labelItalic?: boolean;
  labelUnderline?: boolean;
  labelStrikethrough?: boolean;
  labelBgColor?: string;
  labelAlign?: "left" | "center" | "right";
  /** Label position as an arc-length fraction of the rendered connector. */
  labelPosition?: number;
  /** Horizontal is the legacy default; parallel/follow follows the local wire segment; perpendicular rotates 90°. */
  labelOrientation?: "horizontal" | "parallel" | "perpendicular" | "follow";
  strokeColor?: string;
  strokeWidth?: number;
  dashed?: boolean;
  /** Defaults: no start or end arrow; explicit arrow tools/styles opt in. */
  arrowStart?: boolean;
  arrowEnd?: boolean;
  /** Path shape. Defaults to "straight" (matches current behavior) when unset. */
  lineType?: "straight" | "curved" | "orthogonal";
  /** Optional manual bend points in canvas/world coordinates. */
  waypoints?: { x: number; y: number }[];
  /**
   * Fixed perpendicular-axis coordinate for a 2-bend orthogonal route: the x
   * a left/right `fromSide` connector's vertical trunk sits at, or the y a
   * top/bottom one's horizontal trunk sits at. Unlike `waypoints` (frozen
   * canvas points), the bend's position ALONG the trunk is recomputed from
   * the blocks' current rects every render - so dragging either endpoint
   * re-extends the trunk instead of leaving a stub pointing at a stale spot.
   * Lets several quick-add branches off the same source share one visible
   * spine that still follows a moved shape.
   */
  trunkAxis?: number;
}

export function createConnectorId(): ConnectorId {
  return createWorkspaceId();
}
