import { StylePreset } from "./mindmap-presets";

export type NodeShapeType =
	| "rounded" | "pill" | "underline" | "circle" | "text" | "oval" | "rounded_rect"
	| "diamond" | "triangle" | "hexagon" | "parallelogram" | "star" | "speech_bubble" | "cylinder" | "cross" | "square" | "arrow_line" | "cloud_rect";

export type NodeImageFlow = {
	paragraph: number;
	offset: number;
	/** "block" = the image owns its own line between two paragraphs. */
	side: "inline" | "left" | "right" | "block";
	/** Which text holds the ￼ marker: the node label ("topic") or the
	 * description block. Absent means description (all pre-existing data). */
	text?: "topic" | "description";
	/** Horizontal placement of a "block" image on its own line. Absent = left. */
	align?: "left" | "center" | "right";
};

/** One entry in MindmapNode.images — see that field's doc comment. `width`/
 * `height` (added for the resize-handle feature) follow the same rule as
 * `x`/`y`: undefined means "still at its default filmstrip slot size". */
export type NodeImageEntry = string | {
	url: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	flow?: NodeImageFlow;
};

export interface NodeStyle {
	shape?: NodeShapeType;
	color?: string;
	textColor?: string;
	borderColor?: string;
	borderWidth?: number;
	borderDash?: "solid" | "dashed" | "dotted";

	// Coloring
	bgColor?: string;
	bgOpacity?: number; // 0 to 100


	// Typography
	fontSize?: number;
	fontWeight?: "normal" | "bold";
	fontStyle?: "normal" | "italic";
	fontUnderline?: boolean;
	fontStrikethrough?: boolean;
	fontAlign?: "left" | "center" | "right";
	verticalAlign?: "top" | "middle" | "bottom";
	textStyle?: "plain" | "bullet" | "numbered" | "quote";
	textPadding?: number;
	textMargin?: number;
	fontFamily?: string;
	descriptionStyle?: Pick<NodeStyle, "textColor" | "fontSize" | "fontWeight" | "fontStyle" | "fontUnderline" | "fontStrikethrough" | "fontAlign" | "verticalAlign" | "textStyle" | "textPadding" | "textMargin">;
	rotation?: number;
	groupTransform?: { id: string; centerX: number; centerY: number; angle: number };
	flipH?: boolean;
	flipV?: boolean;
	isLocked?: boolean;

	// Connection line styles
	lineType?: "orthogonal" | "straight" | "curved";
	lineDash?: "solid" | "dashed" | "dotted";
	lineWidth?: number;
	lineColor?: string;
	lineOpacity?: number; // 0 to 100
	arrowStart?: "none" | "arrow" | "dot" | "slash";
	arrowEnd?: "none" | "arrow" | "dot" | "slash";
	reverseDirection?: boolean;
	lineJump?: boolean;
	/** Persisted anchor sides for the automatic connector between Draw Shape nodes. */
	connectorFromSide?: "left" | "right" | "top" | "bottom";
	connectorToSide?: "left" | "right" | "top" | "bottom";
	/** User-created bend points for a free-form Draw Shape connector. */
	connectorWaypoints?: Array<{ x: number; y: number }>;

	// Connection Label
	lineLabel?: string;
	lineLabelColor?: string;
	lineLabelBgColor?: string;
	lineLabelFontSize?: number;
	lineLabelFontWeight?: "normal" | "bold";
	lineLabelFontStyle?: "normal" | "italic";
	lineLabelFontUnderline?: boolean;
	lineLabelFontStrikethrough?: boolean;
	lineLabelLink?: string;
	lineLabelAlign?: "left" | "center" | "right";
	lineLabelOrientation?: "horizontal" | "follow";
	/** Set on a map root drawn with the shape tool: the map belongs to no layout
	 * family at all, every node keeps exactly the position the user gave it, and
	 * `layoutType` is ignored for this map. "Auto arrange" bakes an engine's
	 * output back into those positions without clearing the flag. */
	freeForm?: boolean;
	layoutType?: "logical-right" | "logical-left" | "mindmap" | "mindmap-vertical" | "org-chart" | "catalog" | "timeline" | "vertical-timeline" | "fishbone" | "flowchart" | "swimlane";
	layoutAngle?: number;
	layoutDirection?: "right" | "left" | "down" | "up";
	layoutGrowthMode?: "one-side" | "both-side";
	fishboneMode?: "outward" | "nested";
	timelineBranchMode?: "auto" | "one-side" | "one-side-reverse" | "alternate";
	/** From the activity level down, "hierarchy" grows right-edge-to-left-edge
	 *  like the Hierarchy layout instead of the default stacked treeview. */
	timelineDescendantStyle?: "tree" | "hierarchy";
	/** Treeview branches: "tree" stacks every level in one downward column (the
	 *  default), "hierarchy" centers a parent on its children from level 1 down
	 *  and runs the wire from its right edge to the child's left edge. */
	catalogDescendantStyle?: "tree" | "hierarchy";
	stylePreset?: StylePreset | null;
	connectionStyle?: "curved" | "orthogonal" | "straight";
	nodeShape?: NodeShapeType;
	noParentConnection?: boolean;
}

export interface MindmapRelationship {
	id: string;
	from: string;
	to: string;
	/** Automatic links reselect anchors after layout changes; manual links retain user edits. */
	routeMode?: "auto" | "manual";
	fromSide?: "left" | "right" | "top" | "bottom";
	toSide?: "left" | "right" | "top" | "bottom";
	controlPointOffset?: { x: number; y: number };
	waypoints?: Array<{ x: number; y: number }>;
	/** Explicit vertices for a manually edited right-angle/polyline route. */
	orthogonalWaypoints?: Array<{ x: number; y: number }>;
	type: "straight" | "orthogonal" | "curved" | "straight_arrow";
	lineDash?: "solid" | "dashed" | "dotted";
	lineWidth?: number;
	lineColor?: string;
	lineOpacity?: number; // 0 to 100
	arrowStart?: "none" | "arrow" | "dot" | "slash";
	arrowEnd?: "none" | "arrow" | "dot" | "slash";
	lineJump?: boolean;
	lineLabel?: string;
	lineLabelColor?: string;
	lineLabelBgColor?: string;
	lineLabelFontSize?: number;
	lineLabelFontWeight?: "normal" | "bold";
	lineLabelFontStyle?: "normal" | "italic";
	lineLabelFontUnderline?: boolean;
	lineLabelFontStrikethrough?: boolean;
	lineLabelLink?: string;
	lineLabelAlign?: "left" | "center" | "right";
	lineLabelOrientation?: "horizontal" | "follow";
}

export interface CanvasShape {
	id: string;
	shapeType: NodeShapeType | "sticky_note";
	x: number;
	y: number;
	width: number;
	height: number;
	text?: string;
	bgColor?: string;
	bgOpacity?: number;
	borderColor?: string;
	borderWidth?: number;
	borderDash?: "solid" | "dashed" | "dotted";
	textColor?: string;
	fontSize?: number;
	fontWeight?: "normal" | "bold";
	fontItalic?: boolean;
	fontUnderline?: boolean;
	fontStrikethrough?: boolean;
	fontAlign?: "left" | "center" | "right";
	verticalAlign?: "top" | "middle" | "bottom";
	textStyle?: "plain" | "bullet" | "numbered" | "quote";
	rotation?: number;
	flipH?: boolean;
	flipV?: boolean;
	isLocked?: boolean;
}

export type TableCellId = string;
export interface TableAxisEntry { id: string; size: number; }
export interface TableCellContent {
	version: 1;
	blocks: Array<{ type: "paragraph"; align?: "left" | "center" | "right"; runs: Array<{ text: string; marks?: { bold?: boolean; italic?: boolean; underline?: boolean }; fontSize?: number }> }>;
}
export interface TableCellItem { nodeId: string; order: number; rect: { x: number; y: number; width: number; height: number }; }
export interface MindmapTableV2 {
	version: 2;
	rows: TableAxisEntry[];
	columns: TableAxisEntry[];
	cells: Record<TableCellId, { rowId: string; columnId: string; content: TableCellContent; items: TableCellItem[] }>;
	headerRow?: boolean;
}
export type MindmapTableLegacy = { rows: number; columns: number; cellNodeIds: Record<string, string[]>; columnWidths?: number[]; rowHeights?: number[]; headerRow?: boolean };

export interface MindmapNode {
	id: string;
	topic: string;
	children: MindmapNode[];
	expanded?: boolean;
	style?: NodeStyle;
	/** Optional typography overrides for the description, independent from the title. */
	descriptionStyle?: Pick<NodeStyle, "textColor" | "fontSize" | "fontWeight" | "fontStyle" | "fontUnderline" | "fontStrikethrough" | "fontAlign" | "verticalAlign" | "textStyle" | "textPadding" | "textMargin">;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	floating?: boolean;
	/** A floating node that is the root of a detached/pasted map, not a draw shape. */
	floatingMapRoot?: boolean;

	// Media & Details
	description?: string;
	icon?: string; // emoji
	image?: string; // url or base64 — legacy single-image slot, kept for backward compatibility
	/**
	 * Multiple images (gallery/filmstrip). When non-empty, takes precedence over
	 * `image` for rendering/sizing. New edits write here going forward; `image`
	 * is never migrated in place.
	 *
	 * A plain string is a URL sitting at its default filmstrip slot. The object
	 * form carries an optional `x`/`y` pixel offset (node-local, relative to
	 * that image's default slot) used by the arrow-key nudge feature —
	 * undefined/0 means "unmoved, renders exactly like a plain string entry".
	 * Mixed unions let existing plain-string entries stay valid with no
	 * migration. See svgNodeHelpers.tsx's `resolveNodeImageEntries` /
	 * `getRawNodeImages` — the single seam that normalizes/preserves this.
	 * A `flow` entry is referenced by an object-replacement marker in the
	 * description and renders inside that paragraph; missing/old flow data stays
	 * in the filmstrip for backward compatibility.
	 */
	images?: NodeImageEntry[];
	link?: string; // URL opened when the node title is clicked
	relationships?: MindmapRelationship[];
	/** Read-only legacy payload accepted at the import/persistence migration boundary. */
	table?: MindmapTableLegacy;
	tableV2?: MindmapTableV2;
	tableId?: string;
	tableCellId?: string;
}

export interface PositionedNode {
  node: MindmapNode;
  id: string;
  topic: string;
  x: number;
  y: number;
  width: number;
  height: number;
  level: number;
  branchColor: string;
  direction?: "left" | "right";
}

export interface ConnectionPath {
  id: string;
  d: string;
  color: string;
  arrowEnd?: "arrow" | "dot" | "none";
}

export * from "./mindmap-presets";
export * from "./mindmap-parser";
export * from "./mindmap-cloud";
