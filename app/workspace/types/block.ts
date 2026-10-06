import type { TableBlockPayload } from "./table";
import type { SlideDeckPayload } from "./slide";
import { createWorkspaceId } from "../utils/workspaceId";

export type BlockId = string;

export interface Position {
  x: number;
  y: number;
}

export interface Transform extends Position {
  w: number;
  h: number;
  rotation: number;
  zIndex: number;
}

/** v1 has no auto-arrange producer, so `computed` is always null today — the
 *  field exists so a future layout pass can populate it without a shape change. */
export interface DualTransform {
  computed: Transform | null;
  override: Transform | null;
}

export function resolveTransform(dt: DualTransform, fallback: Transform): Transform {
  return dt.override ?? dt.computed ?? fallback;
}

export function createDualTransform(initial: Transform): DualTransform {
  return { computed: null, override: initial };
}

/** Only for tree-auto-arrange blocks (CONTRACTS.md §24) — positioned by
 *  `computed` until dragged, which writes `override` and "floats" it free. */
export function createComputedTransform(initial: Transform): DualTransform {
  return { computed: initial, override: null };
}

/** Per-type `data` payload contracts. Add one entry here (and a renderer
 *  registration, see renderers/registry.ts) for every new block type. */
export type ShapeKind =
  | "rectangle"
  | "rounded"
  | "rounded_rect"
  | "box"
  | "ellipse"
  | "oval"
  | "circle"
  | "diamond"
  | "triangle"
  | "hexagon"
  | "star"
  | "pill"
  | "parallelogram"
  | "slant"
  | "trapezoid"
  | "speech_bubble"
  | "callout"
  | "cylinder"
  | "cloud"
  | "cloud_rect"
  | "sticky"
  | "sticky_note"
  | "underline"
  | "plain_text";

export type FreehandToolType =
  | "pen"
  | "highlighter"
  | "eraser"
  | "line"
  | "polyline"
  | "cad_line"
  | "square"
  | "circle"
  | "arrow_line"
  | "text";

export type TableCellAlign = "left" | "center" | "right";

export interface TableCellAttachment {
  blockId: BlockId;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BlockDataMap {
  /** Page-style document (TipTap HTML; see WorkspaceDocRichEditor.tsx). */
  doc: { html: string };
  text: {
    markdown: string;
    /** Legacy Mindmap nodes render their text centered by default. */
    align?: "left" | "center" | "right";
    padding?: number;
    /** Base font size in px, applied to both the read-only preview and the
     *  editing textarea. Defaults to the legacy 11px when unset. */
    fontSize?: number;
    fontWeight?: "normal" | "bold" | number;
    fontStyle?: "normal" | "italic";
    fontUnderline?: boolean;
    fontStrikethrough?: boolean;
    textStyle?: "plain" | "bullet" | "numbered" | "quote";
    verticalAlign?: "top" | "middle" | "bottom";
  };
  /** `fit` defaults to "cover" (crops to fill) when unset; "contain" letterboxes
   *  the whole image inside the block instead of cropping it. `extraUrls` are
   *  additional gallery images shown as a filmstrip alongside `url` (which
   *  always stays frame 0) — optional and additive so every existing image
   *  block (no `extraUrls`) keeps rendering exactly as a single image.
   *  `activeIndex` (default 0) selects which frame — 0 is `url`, 1..n index
   *  into `extraUrls[i - 1]` — is shown as the main image. */
  image: {
    url: string;
    alt?: string;
    fit?: "cover" | "contain";
    extraUrls?: string[];
    activeIndex?: number;
    /** Original, uncompressed upload — `url` may be a compressed rendition
     *  used for on-canvas display. Falls back to `url` when absent (older
     *  blocks, or a source where compression wasn't worth doing). */
    downloadUrl?: string;
  };
  /** `previewImageUrl`/`previewDescription`: Open Graph tags, fetched once
   *  per `url` change and cached here (see lib/workspace/link-preview.ts). */
  link: {
    url: string;
    title?: string;
    faviconUrl?: string;
    previewImageUrl?: string;
    previewDescription?: string;
  };
  /** References a WorkspaceResource's original bytes, fetched via GET
   *  /api/workspaces/[id]/resources/[resourceId]. `versionId` absent = latest. */
  file: {
    resourceId: string;
    filename: string;
    mimeType: string;
    sizeBytes: string;
    versionId?: string;
    /** Office-doc PDF-conversion status; absent when mimeType previews directly. */
    previewArtifact?: { status: "PENDING" | "READY" | "FAILED" | "UNSUPPORTED" };
    /** Last-viewed PDF page; absent = page 1. */
    range?: { page: number };
  };
  shape: { shapeKind: ShapeKind; label?: string; frameBlockIds?: BlockId[] };
  /** Freehand pen stroke. `points` are in block-local space (0..w, 0..h) so the
   *  stroke scales naturally if the block is ever resized. */
  path: {
    points: Position[];
    strokeColor?: string;
    strokeWidth?: number;
    tool?: FreehandToolType;
    opacity?: number;
    /** Optional label used by the legacy arrow-line text editor. */
    text?: string;
  };
  /** See TableBlockPayload (types/table.ts) for the full field-by-field doc -
   *  kept out of this file to stay under the 300-line cap. */
  table: TableBlockPayload;
  /** See SlideDeckPayload (types/slide.ts) for the full field-by-field doc. */
  slideDeck: SlideDeckPayload;
}

export type BlockType = keyof BlockDataMap;

/** Content blocks are independent canvas documents, not nodes in a map tree. */
export function isStandaloneContentBlockType(type: BlockType | undefined): boolean {
  return type === "doc" || type === "table" || type === "slideDeck";
}

/** Optional visual overrides applied on top of a renderer's default look. */
export interface BlockStyle {
  /** Shape presentation for text blocks, mirroring the legacy node model. */
  shapeKind?: ShapeKind;
  backgroundColor?: string;
  /** 0–1, applied to backgroundColor only (text/border stay fully opaque) —
   *  see utils/colorOpacity.ts. Undefined/1 means fully opaque. */
  backgroundOpacity?: number;
  borderColor?: string;
  borderWidth?: 1 | 1.5 | 2 | 3;
  borderDash?: "solid" | "dashed" | "dotted";
  /** Applies to text-bearing renderers (currently only "text"); ignored by others. */
  textColor?: string;
  /** Internal markers for values seeded by a diagram template. Each value
   * remains palette-controlled until the user explicitly edits that value. */
  paletteManagedFields?: {
    backgroundColor?: boolean;
    backgroundOpacity?: boolean;
    borderColor?: boolean;
    textColor?: boolean;
  };
  /** Legacy node/shape transform controls exposed by the style menu. */
  flipH?: boolean;
  flipV?: boolean;
  isLocked?: boolean;
}

/** Every layout family a map root can be set to. Declared here rather than
 *  imported from ../layout/treeviewLayout so this types module stays free of
 *  layout-engine imports; treeviewLayout re-exports the same list as
 *  TreeLayoutFamily and the two are kept identical by a compile-time check in
 *  layout/mapLayoutFamilyParity.ts. */
export type MapLayoutFamily =
  | "hierarchy"
  | "treeview"
  | "orgchart"
  | "timeline"
  | "fishbone"
  | "flowchart"
  | "swimlane";

/** Layout preferences owned by one independent map root. */
export interface MapLayoutSettings {
  family: MapLayoutFamily;
  direction: "right" | "left" | "down" | "up";
  /** Optional continuous angle for hierarchy/timeline maps; cardinal choices use direction instead. */
  layoutAngle?: number;
  growthMode: "one-side" | "both-side";
  connectorLineType: "curved" | "orthogonal" | "straight";
  connectorPaletteId: string;
  /** Visual preset selected for this map; block-level custom styles win. */
  stylePresetId?: string;
  timelineBranchMode: "auto" | "one-side" | "one-side-reverse" | "alternate";
  timelineDescendantStyle: "tree" | "hierarchy";
  catalogDescendantStyle: "tree" | "hierarchy";
}

export interface AttachedImage {
  url: string;
  alt?: string;
}

export interface CanvasBlock<T extends BlockType = BlockType> {
  id: BlockId;
  type: T;
  /**
   * Stable membership for a diagram/map. This is intentionally separate from
   * `parentId`: free-form diagrams (flowcharts and swimlanes) have ordinary
   * blocks and explicit connectors without a tree parent relationship.
   */
  mapId?: string;
  transform: DualTransform;
  data: BlockDataMap[T];
  style?: BlockStyle;
  /** Optional single emoji rendered as a small badge on the block's corner. */
  icon?: string;
  /** Optional secondary description/note text rendered below the block's main content. */
  description?: string;
  /** Optional external URL link attached to the block. */
  link?: string;
  /** Optional gallery of images appended to this block. */
  attachedImages?: AttachedImage[];
  /** Tree auto-arrange parent (see CONTRACTS.md §24) — set only for blocks
   *  created via Tab/Enter from another block. Absent for every ordinary
   *  freely-placed block (the vast majority); this is structural metadata,
   *  not a `data` field, since it applies the same way across every block
   *  type, mirroring the old app's MindmapNode.parentId. */
  parentId?: BlockId;
  /** Native table widget is embedded in this document block when set. */
  embeddedInDocId?: BlockId;
  createdAt: number;
  updatedAt: number;
  /** Who last edited this block (email) — set automatically by the store's
   *  updateBlock/updateBlockTransform on every content or transform change.
   *  Powers the attribution dot (BlockAttributionDot.tsx). Absent until the
   *  block's first edit after this field shipped, or if no session email
   *  was resolved yet at edit time. */
  lastEditedBy?: string;
  /** Optional flag indicating if the block's tree children are hidden. */
  isCollapsed?: boolean;
  /** True when block is detached/free-floating rather than auto-arranged in the tree. */
  isFloating?: boolean;
  /** Present on map roots; child blocks inherit this map's layout context. */
  mapLayout?: MapLayoutSettings;
}

export function isTableBlock(block: CanvasBlock): block is CanvasBlock<"table"> {
  return block.type === "table";
}

export function isSlideDeckBlock(block: CanvasBlock): block is CanvasBlock<"slideDeck"> {
  return block.type === "slideDeck";
}

export function createBlockId(): BlockId {
  return createWorkspaceId();
}
