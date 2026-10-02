import { create } from "zustand";
import { isTableBlock, resolveTransform, type BlockId, type BlockStyle, type CanvasBlock, type FreehandToolType, type ShapeKind, type Transform } from "../types/block";
import type { AnchorSide, CanvasConnector, ConnectorId } from "../types/connector";
import type { CameraFrame, CameraState } from "../types/camera";
import { DEFAULT_CAMERA } from "../types/camera";
import type { WorkspaceComment } from "../hooks/workspaceCommentApi";
import type { WorkspaceViewer } from "../hooks/workspacePresenceApi";
import type { TreeDirection, TreeGrowthMode } from "../layout/treeLayout";
import type { TreeLayoutFamily } from "../layout/treeviewLayout";
import { DEFAULT_WORKSPACE_CONNECTOR_LINE_TYPE, withWorkspaceConnectorDefaults, type WorkspaceConnectorLineType, type WorkspaceConnectorPaletteId } from "../connectors/connectorStyle";
import { currentMapLayout } from "../layout/mapRoot";
import { markWorkspaceMutation } from "../utils/workspaceMutationIntent";
import { removeAttachmentFromTables } from "../utils/tableAttachments";

const ZERO_TRANSFORM: Transform = { x: 0, y: 0, w: 160, h: 80, rotation: 0, zIndex: 0 };

export interface WorkspaceStore {
  blocks: Record<BlockId, CanvasBlock>;
  /** Paint/z order — independent of each block's `transform.zIndex` tie-breaks. */
  blockOrder: BlockId[];
  selectedBlockIds: BlockId[];

  /**
   * The quick-add handle that was just activated. Flowchart quick-add keeps
   * the source handle alive for the duration of the pointer handoff: selecting
   * the newly-created block can otherwise put its opposite handle over the
   * exact screen position where the pointer is still resting.
   *
   * This is deliberately transient UI state and is not part of a board
   * snapshot.
   */
  quickAddHandoff: { blockId: BlockId; direction: Exclude<AnchorSide, "center"> } | null;
  setQuickAddHandoff: (handoff: WorkspaceStore["quickAddHandoff"]) => void;
  clearQuickAddHandoff: () => void;

  addBlock: (block: CanvasBlock) => void;
  updateBlock: (id: BlockId, patch: Partial<Omit<CanvasBlock, "id" | "transform">>) => void;
  restoreBlockVersion: (id: BlockId, version: CanvasBlock) => void;
  /** Patches the "computed" or "override" slot of a block's DualTransform. */
  updateBlockTransform: (id: BlockId, patch: Partial<Transform>, kind: "override" | "computed") => void;
  removeBlock: (id: BlockId) => void;
  setSelection: (ids: BlockId[]) => void;
  setBlockOrder: (blockOrder: BlockId[]) => void;

  connectors: Record<ConnectorId, CanvasConnector>;
  treeConnectorLineType: WorkspaceConnectorLineType; treeConnectorPaletteId: WorkspaceConnectorPaletteId;
  addConnector: (connector: CanvasConnector) => void;
  removeConnector: (id: ConnectorId) => void;
  selectedConnectorId: ConnectorId | null;
  setSelectedConnectorId: (id: ConnectorId | null) => void;

  camera: CameraState;
  setCamera: (patch: Partial<CameraState>) => void;
  frames: CameraFrame[];
  setFrames: (frames: CameraFrame[]) => void;

  /** Source block of an in-progress drag-to-connect gesture, or null when idle. */
  pendingConnectorFrom: BlockId | null;
  pendingConnectorFromSide: AnchorSide | null;
  startPendingConnector: (blockId: BlockId, fromSide?: AnchorSide) => void;
  clearPendingConnector: () => void;

  /** Copied style from an in-progress format-painter gesture, or null when idle.
   *  Shared globally (not local component state) so a floating "painting style"
   *  indicator can react to it regardless of which UI copied it. */
  formatPainterStyle: BlockStyle | null;
  setFormatPainterStyle: (style: BlockStyle | null) => void;

  /** Transient UI mode: when true, dragging on the canvas background draws a
   *  freehand path block instead of panning/rubber-band-selecting. */
  isDrawMode: boolean;
  setIsDrawMode: (value: boolean) => void;
  /** Active freehand drawing tool (pen, highlighter, eraser, cad_line, square, circle, arrow_line). */
  activeFreehandTool: FreehandToolType;
  setActiveFreehandTool: (tool: FreehandToolType) => void;

  /** Drag interaction mode: "select" (default — left-drag rubber-band selects) or "pan" (left-drag pans the camera). Transient UI mode. */
  dragMode: "pan" | "select";
  setDragMode: (mode: "pan" | "select") => void;

  /** True for the duration of an active block drag (see useBlockDrag.ts) once
   *  it has crossed the activation threshold. ConnectorLayer reads this to
   *  skip its most expensive per-frame pass (line-overlap avoidance, O(paths
   *  × blocks)) while a drag is live — a diagram with many connectors (e.g.
   *  a flowchart-family map) made every drag frame anywhere on the board pay
   *  that cost otherwise. The final, settled render still runs it. */
  isDraggingBlock: boolean;
  setIsDraggingBlock: (value: boolean) => void;
  /** Exact block set moved by the active drag, including carried descendants.
   *  Transient UI state used by ConnectorLayer for live connector geometry. */
  draggedBlockIds: BlockId[];
  setDraggedBlockIds: (ids: BlockId[]) => void;

  /** Dedicated connector drawing tool mode (pick a line type, then drag from
   *  any block to any other block), or null when idle. See CONTRACTS.md §42. */
  activeConnectorTool: { lineType: "straight" | "curved" | "orthogonal"; arrowEnd: boolean } | null;
  setActiveConnectorTool: (tool: { lineType: "straight" | "curved" | "orthogonal"; arrowEnd: boolean } | null) => void;

  /** Armed shape kind for draw-to-size mode, or null when idle. See CONTRACTS.md §43. */
  armedShapeKind: ShapeKind | null;
  setArmedShapeKind: (kind: ShapeKind | null) => void;

  /** Document title, editable in the top bar. Local-only until a backend exists. */
  title: string;
  setTitle: (title: string) => void;

  /** Id of the board currently open (drives the per-board localStorage key — see
   *  useWorkspaceBoardId.ts / useWorkspacePersistence.ts). Local-only until a
   *  backend exists. */
  boardId: string;
  setBoardId: (boardId: string) => void;

  /** Transient UI mode: when true, clicking a block opens its comment thread
   *  instead of selecting/editing it. See CONTRACTS.md §22. */
  isCommentMode: boolean;
  setIsCommentMode: (value: boolean) => void;
  /** Current width (px) of the open AI chat side panel, 0 when closed. Tracked
   *  here (not just as a DOM CSS var) so the canvas auto-fit-scale effect can
   *  react to it without reaching into another component's local state. */
  chatPanelWidth: number;
  setChatPanelWidth: (width: number) => void;
  /** Which block's comment composer is currently open (comment mode's
   *  equivalent of the old app's single-composer-instance pattern). */
  activeCommentBlockId: BlockId | null;
  setActiveCommentBlockId: (id: BlockId | null) => void;
  /** All comments for the open board, refreshed by a polling hook — REST
   *  polling, no realtime channel (see CONTRACTS.md §22). */
  comments: WorkspaceComment[];
  setComments: (comments: WorkspaceComment[]) => void;

  /** PDF/file-block page currently being *browsed* — deliberately separate
   *  from `block.data.range.page` (the persisted/"pinned" page) so stepping
   *  through pages with the toolbar's prev/next doesn't trigger an autosave
   *  on every click. Ephemeral, like activeCommentBlockId above — never part
   *  of the saved board payload. See WorkspaceFileSelectionToolbar.tsx. */
  filePreviewPage: Record<BlockId, number>;
  setFilePreviewPage: (id: BlockId, page: number) => void;
  /** Filled in once pdfjs resolves a file block's page count (FilePdfCanvasPreview.tsx). */
  filePreviewPageCount: Record<BlockId, number>;
  setFilePreviewPageCount: (id: BlockId, count: number) => void;

  /** An `image` block's real width/height ratio, read off the loaded
   *  <img> (naturalWidth/naturalHeight) rather than the block's current
   *  frame — the frame can drift away from it after a free (non-Ctrl)
   *  resize, but Ctrl-locked resizing (see useBlockResize.ts) must always
   *  snap back to the image's own ratio, not whatever the frame happens to
   *  be. Ephemeral, same as the file-preview fields above. */
  imageNaturalAspect: Record<BlockId, number>;
  setImageNaturalAspect: (id: BlockId, ratio: number) => void;

  /** Growth direction for the tree auto-arrange flow (Tab/Enter), board-wide
   *  — matches the old app's map-level layout direction (CONTRACTS.md §24).
   *  Defaults to "right" (the old app's default too). */
  treeLayoutDirection: TreeDirection;
  setTreeLayoutDirection: (direction: TreeDirection) => void;

  /** Growth mode for the tree auto-arrange flow: "one-side" (default) grows
   *  all children in treeLayoutDirection; "both-side" splits root's direct
   *  children into two mirrored groups (CONTRACTS.md §26). */
  treeGrowthMode: TreeGrowthMode;
  setTreeGrowthMode: (mode: TreeGrowthMode) => void;

  /** Layout family for the tree auto-arrange flow: "hierarchy" (default —
   *  direction-based tree) or "treeview" (depth-column outline). See
   *  CONTRACTS.md §36. */
  treeLayoutFamily: TreeLayoutFamily;
  setTreeLayoutFamily: (family: TreeLayoutFamily) => void;

  treeTimelineBranchMode: "auto" | "one-side" | "one-side-reverse" | "alternate";
  setTreeTimelineBranchMode: (mode: "auto" | "one-side" | "one-side-reverse" | "alternate") => void;

  treeTimelineDescendantStyle: "tree" | "hierarchy";
  setTreeTimelineDescendantStyle: (style: "tree" | "hierarchy") => void;
  treeCatalogDescendantStyle: "tree" | "hierarchy";
  setTreeCatalogDescendantStyle: (style: "tree" | "hierarchy") => void;

  /** True when the caller's role on the open board is VIEWER (see
   *  CONTRACTS.md §33) — every content-mutating action below becomes a
   *  no-op. Set once per board load by useBoardViewerRole.ts; the server
   *  already rejects VIEWER writes independently (§21), this just stops the
   *  client from producing local-only changes that would silently fail to
   *  persist (a confusing UX, not a security hole — the 403 always wins). */
  isReadOnly: boolean;
  setIsReadOnly: (value: boolean) => void;

  /** Other collaborators currently viewing this board, refreshed on each
   *  presence heartbeat tick (see useWorkspacePresence.ts) — powers the
   *  presence focus ring (BlockPresenceRing.tsx) via each viewer's
   *  selectedBlockId. Excludes the caller themself (server-side filtered). */
  remoteViewers: WorkspaceViewer[];
  setRemoteViewers: (viewers: WorkspaceViewer[]) => void;

  /** The signed-in caller's email, set once by WorkspacePage.tsx via
   *  next-auth's useSession — stamped onto CanvasBlock.lastEditedBy by
   *  updateBlock/updateBlockTransform (see BlockAttributionDot.tsx). */
  currentUserEmail: string | null;
  setCurrentUserEmail: (email: string | null) => void;

  /** Full-size image viewer state — see WorkspaceImageLightbox.tsx.
   *  Set by ImageBlock.tsx on double-click, mirroring the old app's
   *  MindmapImageLightbox.tsx "store as bridge" convention (avoids
   *  threading a prop through the whole canvas/block-frame chain). */
  imageLightbox: { urls: string[]; index: number } | null;
  setImageLightbox: (value: { urls: string[]; index: number } | null) => void;

  /** Block a creation flow (toolbar "Add Text", Tab/Enter quick-add) just
   *  placed — TextBlock.tsx watches for its own id here to auto-enter edit
   *  mode once, then clears it, mirroring the old app's
   *  `setTimeout(() => startEditing(newId), 50)` after every node-creation
   *  action so a freshly created block is immediately typeable. */
  pendingEditBlockId: BlockId | null;
  setPendingEditBlockId: (id: BlockId | null) => void;
  /** A double-click that fell through a swimlane body cell's empty area
   *  (pointer-events:none - see TableBlock.tsx's passThroughEmptyCellClicks)
   *  down to the canvas background - WorkspaceCanvas.tsx's dblclick handler
   *  re-targets it here so the owning TableBlock can enter that cell's text
   *  edit mode itself, mirroring pendingEditBlockId's "outside trigger,
   *  self-clears" pattern above. */
  pendingEditTableCell: { tableId: BlockId; row: number; col: number } | null;
  setPendingEditTableCell: (value: { tableId: BlockId; row: number; col: number } | null) => void;
  /** A doc/slideDeck line's "Copy link to block" was opened via URL
   *  (?focusLine=<id>) — WorkspaceDocLineOverlay.tsx watches for its own
   *  editor to contain a node with this lineId, then scrolls/highlights it
   *  and self-clears, mirroring pendingEditBlockId's pattern above. */
  pendingFocusLineId: string | null;
  setPendingFocusLineId: (id: string | null) => void;
  editingBlockId: BlockId | null;
  setEditingBlockId: (id: BlockId | null) => void;
  pendingDescriptionBlockId: BlockId | null;
  setPendingDescriptionBlockId: (id: BlockId | null) => void;
  /** The rich-text (TipTap) editor currently open for in-place editing —
   *  set by WorkspaceShapeRichEditor.tsx while a shape's label is being
   *  edited, cleared on blur/unmount. Lets WorkspaceSelectionToolbar.tsx's
   *  Bold/Italic/Underline/Strikethrough/list buttons apply to the actual
   *  text SELECTION inside that editor — those buttons used to only ever
   *  patch a whole-block style flag on `block.data` (the right model for
   *  TextBlock.tsx's markdown field, meaningless for a shape's per-run rich
   *  content), so clicking them while editing a shape's label did nothing.
   *  A structural command surface, not a TipTap `Editor` import, so this
   *  core store file stays independent of any specific editor library. */
  activeRichTextEditor: { blockId: BlockId; commands: WorkspaceInlineRichEditorCommands; activeMarks: WorkspaceInlineRichEditorActiveMarks } | null;
  setActiveRichTextEditor: (value: WorkspaceStore["activeRichTextEditor"]) => void;
}

export interface WorkspaceInlineRichEditorCommands {
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleUnderline: () => void;
  toggleStrike: () => void;
  toggleBulletList: () => void;
  toggleOrderedList: () => void;
  toggleBlockquote: () => void;
  setTextAlign: (align: "left" | "center" | "right" | "justify") => void;
  /** Doc-block-only commands (WorkspaceDocRichEditor.tsx) — a shape's label
   *  editor has no heading/checklist/link/code concept (see its own doc
   *  comment), so these stay optional rather than forcing every editor to
   *  implement no-ops. */
  toggleCode?: () => void;
  toggleHeading1?: () => void;
  toggleHeading2?: () => void;
  toggleHeading3?: () => void;
  toggleTaskList?: () => void;
  /** Applies/replaces the link on the current selection (or the link the
   *  caret sits inside). window.prompt() isn't usable here — it throws in
   *  this app's runtime — so the URL comes from WorkspaceDocFormatToolbar's
   *  own popover input instead of a native prompt. */
  setLink?: (url: string) => void;
  unsetLink?: () => void;
  insertImage?: (src: string, alt?: string) => void;
}

/** A live snapshot of the current selection's formatting, refreshed on
 *  every selection/content change (WorkspaceShapeRichEditor.tsx's
 *  onSelectionUpdate/onTransaction) — lets WorkspaceSelectionToolbar.tsx's
 *  Bold/Italic/.../list buttons show whether the selected text ALREADY has
 *  that mark, the same way they already do for a TextBlock's whole-block
 *  style flags. */
export interface WorkspaceInlineRichEditorActiveMarks {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
  align: "left" | "center" | "right" | "justify";
  /** Doc-block-only marks — see WorkspaceInlineRichEditorCommands. */
  code?: boolean;
  heading1?: boolean;
  heading2?: boolean;
  heading3?: boolean;
  taskList?: boolean;
  link?: boolean;
  linkHref?: string;
}
export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  blocks: {},
  blockOrder: [],
  selectedBlockIds: [],
  quickAddHandoff: null,
  setQuickAddHandoff: (handoff) => set({ quickAddHandoff: handoff }),
  clearQuickAddHandoff: () => set({ quickAddHandoff: null }),

  addBlock: (block) =>
    set((state) => {
      if (state.isReadOnly) return state;
      return {
        blocks: { ...state.blocks, [block.id]: block },
        blockOrder: [...state.blockOrder, block.id],
      };
    }),

  updateBlock: (id, patch) =>
    set((state) => {
      if (state.isReadOnly) return state;
      const existing = state.blocks[id];
      if (!existing) return state;
      return {
        blocks: {
          ...state.blocks,
          [id]: {
            ...existing,
            ...patch,
            updatedAt: Date.now(),
            lastEditedBy: state.currentUserEmail ?? existing.lastEditedBy,
          },
        },
      };
    }),

  restoreBlockVersion: (id, version) =>
    set((state) => {
      if (state.isReadOnly || !state.blocks[id]) return state;
      markWorkspaceMutation("node.restore");
      const current = state.blocks[id];
      return {
        blocks: {
          ...state.blocks,
          [id]: {
            ...version,
            id,
            createdAt: current.createdAt,
            updatedAt: Date.now(),
            lastEditedBy: state.currentUserEmail ?? current.lastEditedBy,
          },
        },
      };
    }),

  updateBlockTransform: (id, patch, kind) =>
    set((state) => {
      if (state.isReadOnly) return state;
      const existing = state.blocks[id];
      if (!existing) return state;
      // Falls back to the block's other (currently-resolved) slot before
      // ZERO_TRANSFORM — a block positioned only by `computed` (tree
      // auto-arrange, see CONTRACTS.md §24) must inherit its real w/h/zIndex
      // the first time a drag/resize/rotate writes its `override`, not reset
      // to a hardcoded 160x80 box.
      const base = existing.transform[kind] ?? resolveTransform(existing.transform, ZERO_TRANSFORM);
      return {
        blocks: {
          ...state.blocks,
          [id]: {
            ...existing,
            transform: { ...existing.transform, [kind]: { ...base, ...patch } },
            updatedAt: Date.now(),
            lastEditedBy: state.currentUserEmail ?? existing.lastEditedBy,
          },
        },
      };
    }),

  removeBlock: (id) =>
    set((state) => {
      if (state.isReadOnly) return state;
      const rest = { ...state.blocks };
      delete rest[id];
      const attachmentChanges = removeAttachmentFromTables(state.blocks, id);
      for (const [tableId, cellItems] of Object.entries(attachmentChanges)) {
        const table = rest[tableId];
        if (table && isTableBlock(table)) {
          rest[tableId] = { ...table, data: { ...table.data, cellItems } };
        }
      }
      return {
        blocks: rest,
        blockOrder: state.blockOrder.filter((blockId) => blockId !== id),
        selectedBlockIds: state.selectedBlockIds.filter((blockId) => blockId !== id),
      };
    }),

  setSelection: (ids) => set({ selectedBlockIds: ids }),
  setBlockOrder: (blockOrder) =>
    set((state) => (state.isReadOnly ? state : { blockOrder })),

  connectors: {},
  treeConnectorLineType: DEFAULT_WORKSPACE_CONNECTOR_LINE_TYPE, treeConnectorPaletteId: "default",
  addConnector: (connector) =>
    set((state) => {
      if (state.isReadOnly) return state;
      const mapLayout = currentMapLayout(state, connector.fromBlockId);
      const normalized = withWorkspaceConnectorDefaults(connector, mapLayout.connectorLineType, mapLayout.connectorPaletteId, Object.keys(state.connectors).length);
      return { connectors: { ...state.connectors, [connector.id]: normalized } };
    }),
  removeConnector: (id) =>
    set((state) => {
      if (state.isReadOnly) return state;
      const rest = { ...state.connectors };
      delete rest[id];
      return {
        connectors: rest,
        selectedConnectorId: state.selectedConnectorId === id ? null : state.selectedConnectorId,
      };
    }),
  selectedConnectorId: null,
  setSelectedConnectorId: (id) => set({ selectedConnectorId: id }),

  camera: DEFAULT_CAMERA,
  setCamera: (patch) => set((state) => ({ camera: { ...state.camera, ...patch } })),

  frames: [],
  setFrames: (frames) => set({ frames }),

  pendingConnectorFrom: null,
  pendingConnectorFromSide: null,
  startPendingConnector: (blockId, fromSide) => set({ pendingConnectorFrom: blockId, pendingConnectorFromSide: fromSide ?? null }),
  clearPendingConnector: () => set({ pendingConnectorFrom: null, pendingConnectorFromSide: null }),

  formatPainterStyle: null,
  setFormatPainterStyle: (style) => set({ formatPainterStyle: style }),

  isDrawMode: false,
  setIsDrawMode: (value) => set({ isDrawMode: value }),
  activeFreehandTool: "pen",
  setActiveFreehandTool: (tool) => set({ activeFreehandTool: tool }),


  dragMode: "pan",
  setDragMode: (mode) => set({ dragMode: mode }),

  isDraggingBlock: false,
  setIsDraggingBlock: (value) => set({ isDraggingBlock: value }),
  draggedBlockIds: [],
  setDraggedBlockIds: (ids) => set({ draggedBlockIds: ids }),

  activeConnectorTool: null,
  setActiveConnectorTool: (tool) => set({ activeConnectorTool: tool }),

  armedShapeKind: null,
  setArmedShapeKind: (kind) => set({ armedShapeKind: kind }),

  title: "New Mindmap",
  setTitle: (title) => set((state) => (state.isReadOnly ? state : { title })),

  boardId: "",
  setBoardId: (boardId) => set({ boardId }),

  isCommentMode: false,
  setIsCommentMode: (value) => set({ isCommentMode: value, activeCommentBlockId: null }),
  chatPanelWidth: 0,
  setChatPanelWidth: (width) => set({ chatPanelWidth: width }),
  activeCommentBlockId: null,
  setActiveCommentBlockId: (id) => set({ activeCommentBlockId: id }),
  filePreviewPage: {},
  setFilePreviewPage: (id, page) => set((state) => ({ filePreviewPage: { ...state.filePreviewPage, [id]: page } })),
  filePreviewPageCount: {},
  setFilePreviewPageCount: (id, count) => set((state) => ({ filePreviewPageCount: { ...state.filePreviewPageCount, [id]: count } })),
  imageNaturalAspect: {},
  setImageNaturalAspect: (id, ratio) => set((state) => ({ imageNaturalAspect: { ...state.imageNaturalAspect, [id]: ratio } })),
  comments: [],
  setComments: (comments) => set({ comments }),

  treeLayoutDirection: "right",
  setTreeLayoutDirection: (direction) => set({ treeLayoutDirection: direction }),

  treeGrowthMode: "one-side",
  setTreeGrowthMode: (mode) => set({ treeGrowthMode: mode }),

  treeLayoutFamily: "hierarchy",
  setTreeLayoutFamily: (family) => set({ treeLayoutFamily: family }),

  treeTimelineBranchMode: "auto",
  setTreeTimelineBranchMode: (mode) => set({ treeTimelineBranchMode: mode }),
  treeTimelineDescendantStyle: "tree",
  setTreeTimelineDescendantStyle: (style) => set({ treeTimelineDescendantStyle: style }),
  treeCatalogDescendantStyle: "tree",
  setTreeCatalogDescendantStyle: (style) => set({ treeCatalogDescendantStyle: style }),

  isReadOnly: false,
  setIsReadOnly: (value) => set({ isReadOnly: value }),

  remoteViewers: [],
  setRemoteViewers: (viewers) => set({ remoteViewers: viewers }),

  currentUserEmail: null,
  setCurrentUserEmail: (email) => set({ currentUserEmail: email }),

  imageLightbox: null,
  setImageLightbox: (value) => set({ imageLightbox: value }),

  pendingEditBlockId: null,
  setPendingEditBlockId: (id) => set({ pendingEditBlockId: id }),
  pendingFocusLineId: null,
  setPendingFocusLineId: (id) => set({ pendingFocusLineId: id }),
  pendingEditTableCell: null,
  setPendingEditTableCell: (value) => set({ pendingEditTableCell: value }),
  editingBlockId: null,
  setEditingBlockId: (id) => set({ editingBlockId: id }),
  pendingDescriptionBlockId: null,
  setPendingDescriptionBlockId: (id) => set({ pendingDescriptionBlockId: id }),
  activeRichTextEditor: null,
  setActiveRichTextEditor: (value) => set({ activeRichTextEditor: value }),
}));
