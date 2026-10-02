import {
  createBlockId,
  createComputedTransform,
  type BlockStyle,
  type CanvasBlock,
} from "../../types/block";
import { createConnectorId, type CanvasConnector } from "../../types/connector";

export type SwimlaneOrientation = "horizontal" | "vertical";

export interface SwimlaneTemplateIdFactory {
  blockId?: (key: string, index: number) => string;
  connectorId?: (fromBlockId: string, toBlockId: string, index: number) => string;
}

export interface SwimlaneTemplateResult {
  blocks: Array<CanvasBlock & { mapId: string }>;
  connectors: CanvasConnector[];
  rootId: string;
}

const LANE_LABELS = ["Lane 1", "Lane 2", "Lane 3"];
const STEP_LABELS = ["Step 1", "Step 2"];

const STEP_SIZE = { w: 160, h: 64 };
const STEP_GAP = 48;
const BODY_PADDING = 32;
/** The label column/row's own thickness - it IS the header cell, filling it
 *  edge to edge, same idea `swimlaneLaneCells.ts` uses for the tree model. */
const LANE_LABEL_THICKNESS = 120;
// A horizontal lane is a ROW: its thickness is a height, sized to fit one
// step's HEIGHT. A vertical lane is a COLUMN: its thickness is a width,
// sized to fit one step's WIDTH. Steps are not square (160x64), so these
// must stay two separate constants - sharing one made every vertical lane
// too narrow for its own steps, which then overflowed the table on both
// sides.
const LANE_ROW_THICKNESS = STEP_SIZE.h + BODY_PADDING * 2;
const LANE_COL_THICKNESS = STEP_SIZE.w + BODY_PADDING * 2;
// Horizontal flows steps side by side (uses step width); vertical stacks
// them top to bottom (uses step height) - each needs its own body run length
// or the shorter one leaves the steps stranded near the header boundary.
const BODY_LENGTH_HORIZONTAL = STEP_LABELS.length * STEP_SIZE.w + (STEP_LABELS.length - 1) * STEP_GAP + BODY_PADDING * 2;
const BODY_LENGTH_VERTICAL = STEP_LABELS.length * STEP_SIZE.h + (STEP_LABELS.length - 1) * STEP_GAP + BODY_PADDING * 2;

const stepStyle: BlockStyle = {
  backgroundColor: "#ffffff",
  borderColor: "#94a3b8",
  borderWidth: 1.5,
  textColor: "#0f172a",
};

/**
 * Builds a Lark-style swimlane: one real `table` block as the lane grid (no
 * `parentId`) plus ordinary freeform `text` step blocks on top, wired by
 * explicit step-to-step connectors only. Nothing here is parented to
 * anything else - lane membership is purely where a step sits, matching the
 * reference tool (see `.claude/specs/active/larksuite-board-observations-2026-09-03.md`).
 */
export function buildSwimlaneTemplateBlocks(
  orientation: SwimlaneOrientation,
  mapId: string,
  origin: { x: number; y: number },
  ids: SwimlaneTemplateIdFactory | undefined,
  now: number,
): SwimlaneTemplateResult {
  const laneCount = LANE_LABELS.length;
  const horizontal = orientation === "horizontal";

  const bodyLength = horizontal ? BODY_LENGTH_HORIZONTAL : BODY_LENGTH_VERTICAL;
  const laneThickness = horizontal ? LANE_ROW_THICKNESS : LANE_COL_THICKNESS;
  const tableId = ids?.blockId?.("swimlane-table", 0) ?? createBlockId();
  const tableTransform = horizontal
    ? { w: LANE_LABEL_THICKNESS + bodyLength, h: laneCount * laneThickness }
    : { w: laneCount * laneThickness, h: LANE_LABEL_THICKNESS + bodyLength };

  const cells: string[][] = horizontal
    ? LANE_LABELS.map((label) => [label, ""])
    : [LANE_LABELS.slice(), LANE_LABELS.map(() => "")];

  const tableBlock: CanvasBlock<"table"> & { mapId: string } = {
    id: tableId,
    mapId,
    type: "table",
    transform: createComputedTransform({ ...tableTransform, ...origin, rotation: 0, zIndex: 0 }),
    data: {
      rows: horizontal ? laneCount : 2,
      cols: horizontal ? 2 : laneCount,
      cells,
      headerRow: !horizontal,
      headerCol: horizontal,
      rowWeights: horizontal ? Array(laneCount).fill(laneThickness) : [LANE_LABEL_THICKNESS, bodyLength],
      colWeights: horizontal ? [LANE_LABEL_THICKNESS, bodyLength] : Array(laneCount).fill(laneThickness),
      // The step-to-step connectors cross straight through these empty body
      // cells - without this, clicking a connector selects the table cell
      // underneath it instead, and the connector can never be selected or
      // labeled.
      passThroughEmptyCellClicks: true,
      // Steps are free shapes placed over the grid, not content dropped onto
      // it - never let dragging one near/across a cell pin it there (see
      // BlockType.disableCellAttachment's doc comment for why that resists
      // later drags).
      disableCellAttachment: true,
    },
    // Connectors render in a layer beneath every block (so an arrow tucks
    // cleanly under whatever block it meets), and a block's own zIndex only
    // reorders it against ITS OWN siblings, not against that separate
    // connector layer - the table's default opaque white fill was simply
    // painting over the step connectors crossing its body regardless of any
    // zIndex value. Transparent removes that paint, letting the layer
    // beneath show through; only the header cells (styled in TableBlock.tsx)
    // carry their own tint.
    style: { borderColor: "#94a3b8", backgroundColor: "transparent" },
    createdAt: now,
    updatedAt: now,
  };

  const blocks: Array<CanvasBlock & { mapId: string }> = [tableBlock];
  const connectors: CanvasConnector[] = [];
  let blockIndex = 1;
  let connectorIndex = 0;

  LANE_LABELS.forEach((_, laneIndex) => {
    const stepIds = STEP_LABELS.map((label, stepIndex) => {
      const id = ids?.blockId?.(`swimlane-step-${laneIndex}-${stepIndex}`, blockIndex) ?? createBlockId();
      blockIndex += 1;

      const position = horizontal
        ? {
          x: origin.x + LANE_LABEL_THICKNESS + BODY_PADDING + stepIndex * (STEP_SIZE.w + STEP_GAP),
          y: origin.y + laneIndex * laneThickness + laneThickness / 2 - STEP_SIZE.h / 2,
        }
        : {
          x: origin.x + laneIndex * laneThickness + laneThickness / 2 - STEP_SIZE.w / 2,
          y: origin.y + LANE_LABEL_THICKNESS + BODY_PADDING + stepIndex * (STEP_SIZE.h + STEP_GAP),
        };

      blocks.push({
        id,
        mapId,
        // "text" blocks are what every tree-template node uses, and
        // WorkspaceSelectionToolbar.tsx treats any selected, parentless block
        // as a (wrongly) "map root", surfacing the Hierarchy/Swimlane/...
        // structure switcher on it - already worked around for "shape"
        // blocks there (see its comment), which these steps are for free.
        type: "shape",
        // A plain incrementing z-index is enough now that BlockFrame.tsx no
        // longer elevates a hovered/selected TABLE above its resting value
        // (see its comment) - the table can never outrank these regardless
        // of hover, so a step created later via the generic "+" quick-add
        // (which assigns its own low zIndex from blockOrder.length) stays
        // safely above the table too, with no swimlane-specific bump needed.
        transform: createComputedTransform({ ...STEP_SIZE, ...position, rotation: 0, zIndex: blockIndex }),
        data: { shapeKind: "rounded_rect", label },
        style: stepStyle,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    });

    for (let i = 0; i < stepIds.length - 1; i += 1) {
      const connectorId = ids?.connectorId?.(stepIds[i], stepIds[i + 1], connectorIndex) ?? createConnectorId();
      connectorIndex += 1;
      // Pinned to the lane's own flow direction (vertical lane: bottom of
      // step N into top of step N+1; horizontal lane: right into left) -
      // fixed on purpose. Re-deriving the side from relative position on
      // every render (what an earlier version of this did) meant the wire's
      // exit/entry edge itself would flip to a different side of the shape
      // once a step was dragged past the other's center on the cross axis,
      // which reads as the wire changing its own start/end point. A pinned
      // side never flips; connectorGeometry.ts's swimlane path builder still
      // re-derives only the bend's position (always the midpoint) from the
      // shapes' live rects, so the trunk still stretches/shrinks as either
      // step moves along its own lane.
      connectors.push({
        id: connectorId,
        fromBlockId: stepIds[i],
        toBlockId: stepIds[i + 1],
        fromSide: horizontal ? "right" : "bottom",
        toSide: horizontal ? "left" : "top",
        lineType: "orthogonal",
        arrowEnd: true,
      });
    }
  });

  return { blocks, connectors, rootId: tableId };
}
