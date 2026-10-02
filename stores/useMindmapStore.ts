import { create } from "zustand";
import { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import type { CommentsByNodeId } from "@/app/mindmap/hooks/useMindmapComments";
import type { NodeVersionPreview } from "@/app/mindmap/components/NodeHistoryPopover.utils";

export type MindmapCommentsConnection = {
	status: "disconnected" | "connected" | "connecting" | "error";
	connected: boolean;
	connecting: boolean;
	error: string | null;
};

export interface MindmapItem {
	id: string;
	title: string;
	updatedAt: number;
	/** Server-authoritative access role used by sidebar actions. */
	accessRole?: "owner" | "VIEWER" | "EDITOR";
	isOwner?: boolean;
	/** When the map was created. The sidebar orders by this so a map keeps its
	 *  place in the list no matter how often it is edited. */
	createdAt?: number;
	/** Whether anyone besides the owner has been invited — see
	 *  MindmapListPanel.tsx hasUnseenUpdates(). Absent for local-only ("mm_")
	 *  drafts, which have never touched the server and can't be shared yet. */
	hasCollaborators?: boolean;
	/** Whether the map has an active, non-expired anonymous public link. */
	hasPublicViewLink?: boolean;
}

export interface MindmapChatMessage {
	role: "user" | "assistant";
	content: string;
	id: string;
}

/**
 * One remote collaborator's live presence/awareness state, as broadcast via
 * y-protocols/awareness over the mindmap-ws connection (lib/mindmap/ydoc.ts).
 * In-memory/ephemeral only — never persisted to Postgres (see PRESENCE step
 * of the mindmap realtime spec). Keyed by userEmail in `remoteAwareness`
 * below, i.e. this is the "map of remote userEmail -> focusedNodeId" (plus
 * the display metadata needed to render an avatar stack / cursor rings)
 * that extends the pre-existing local-only `focusedNodeId` concept.
 */
export interface RemoteAwarenessState {
	userEmail: string;
	name: string;
	/** Deterministically derived from email (see lib/mindmap/awareness-color.ts) so the same user always gets the same color across sessions/tabs. */
	color: string;
	focusedNodeId: string | null;
	/** Yjs awareness clientId this state currently belongs to — lets us tell apart the same user connected from two tabs and clean up stale entries per-client. */
	clientId: number;
}

interface MindmapStore {
	sidebarView: "list" | "outline";
	currentMindmapId: string | null;
	currentTree: MindmapNode | null;
	/** Which map `currentTree` belongs to. The projection is shared by every
	 *  surface (outline, realtime, canvas), so without this tag a tree left
	 *  behind by the previously open map reads as an update for the map that
	 *  is open now — and gets painted onto it, then autosaved under its id. */
	currentTreeMindmapId: string | null;
	mindmapList: MindmapItem[];
	chatMessages: MindmapChatMessage[];
	focusedNodeId: string | null;
	/** Live remote presence, keyed by userEmail. Populated/cleared entirely by lib/mindmap/ydoc.ts's awareness listener — never written to directly by editor UI code. */
	remoteAwareness: Record<string, RemoteAwarenessState>;
	/** Who last changed the canvas from another window, and when — drives the
	 *  "X is editing…" status next to the presence avatars. Null when nothing
	 *  remote has happened yet this session. */
	remoteEditingBy: { name: string; color: string; at: number } | null;
	setRemoteEditingBy: (editor: { name: string; color: string; at: number } | null) => void;
	setSidebarView: (view: "list" | "outline") => void;
	setCurrentMindmapId: (id: string | null) => void;
	setCurrentTree: (tree: MindmapNode, mindmapId?: string | null) => void;
	setMindmapList: (list: MindmapItem[]) => void;
	addChatMessage: (msg: MindmapChatMessage) => void;
	updateLastAssistantMessage: (content: string) => void;
	clearChatMessages: () => void;
	setFocusedNodeId: (id: string | null) => void;
	setRemoteAwareness: (byEmail: Record<string, RemoteAwarenessState>) => void;
	highlightedNodeIds: string[];
	setHighlightedNodeIds: (ids: string[]) => void;
	/**
	 * The canvas editor's tree lives in local React state (see page.tsx's
	 * `tree`/`updateTreeState`), not in this store — `currentTree` above is a
	 * one-way mirror of it (see usePageMindmapIdSync). Sidebar editors (the
	 * outline panels) can't write to that local state directly, so they park
	 * an edit here; the page applies it through the real `updateTreeState`
	 * (preserving undo history/autosave) and clears it right after.
	 */
	pendingTreeUpdate: MindmapNode | null;
	requestTreeUpdate: (tree: MindmapNode) => void;
	clearPendingTreeUpdate: () => void;
	/**
	 * Same "park it on the store" pattern as pendingTreeUpdate above, for a
	 * rename made in the sidebar (MindmapListPanel) while that same map is
	 * open on the canvas — the sidebar can't reach the page's local title
	 * state directly. Carries `id` (unlike pendingTreeUpdate) because the
	 * sidebar can rename any map in the list, not just the currently open
	 * one; the page ignores requests for a different id.
	 */
	pendingTitleUpdate: { id: string; title: string } | null;
	requestTitleUpdate: (id: string, title: string) => void;
	clearPendingTitleUpdate: () => void;
	/** Whether the full comments panel is visible from the topbar. */
	commentMode: boolean;
	setCommentMode: (v: boolean) => void;
	/**
	 * Bridge for the realtime comments channel (see
	 * app/mindmap/hooks/useMindmapComments.ts + lib/mindmap/comments-client.ts).
	 * Populated by useMindmapCommentsBridge (called once at the page level) so
	 * deeply-nested SVG components (CommentBadge, CommentComposer, SvgNodeItem)
	 * can read/act on comments without threading new props through the
	 * PageCanvas/PageSvgCanvas prop chain — same "store as bridge" convention
	 * already used for remoteAwareness/currentTree above.
	 */
	commentsByNodeId: CommentsByNodeId;
	setCommentsByNodeId: (byNodeId: CommentsByNodeId) => void;
	commentsConnection: MindmapCommentsConnection;
	setCommentsConnection: (connection: MindmapCommentsConnection) => void;
	/** Node currently showing the comment composer/thread popover, or null. */
	activeCommentNodeId: string | null;
	setActiveCommentNodeId: (nodeId: string | null) => void;
	commentActions: {
		addComment: (nodeId: string, body: string, parentCommentId?: string | null) => void;
		updateComment: (commentId: string, body: string) => void;
		resolveComment: (commentId: string, resolved: boolean) => void;
		resolveThread: (commentId: string, resolved: boolean) => void;
		deleteComment: (commentId: string) => void;
	};
	setCommentActions: (actions: MindmapStore["commentActions"]) => void;
	/**
	 * Full-size image viewer for node images (see SvgNodeImages.tsx). Same
	 * "store as bridge" convention as activeCommentNodeId: the lightbox is
	 * mounted once at the page level, so a deeply-nested node image click
	 * doesn't need a dedicated prop threaded through the whole canvas chain.
	 */
	imageLightbox: { urls: string[]; index: number } | null;
	setImageLightbox: (state: { urls: string[]; index: number } | null) => void;
	/**
	 * Which single image inside a node's gallery is selected for the arrow-key
	 * nudge feature (see useImageNudge.ts). Distinct from imageLightbox above:
	 * clicking an image body (while its node is already selected) sets this;
	 * the hover-reveal zoom icon still opens the lightbox instead. Cleared on
	 * Escape, on clicking elsewhere, and whenever the owning node is
	 * deselected — see useImageNudge.ts for all three.
	 */
	selectedImage: { nodeId: string; index: number } | null;
	setSelectedImage: (state: { nodeId: string; index: number } | null) => void;
	/** Whether author/attribution dots are visible on the canvas. */
	showAttribution: boolean;
	setShowAttribution: (v: boolean) => void;
	/** Whether comment badges & composers are visible on the canvas. */
	showCanvasComments: boolean;
	setShowCanvasComments: (v: boolean) => void;
	nodeVersionPreview: NodeVersionPreview | null;
	setNodeVersionPreview: (version: NodeVersionPreview | null) => void;
}

const noopCommentActions: MindmapStore["commentActions"] = {
	addComment: () => {},
	updateComment: () => {},
	resolveComment: () => {},
	resolveThread: () => {},
	deleteComment: () => {},
};

export const useMindmapStore = create<MindmapStore>((set, get) => ({
	sidebarView: "list",
	currentMindmapId: null,
	currentTree: null,
	currentTreeMindmapId: null,
	mindmapList: [],
	chatMessages: [],
	focusedNodeId: null,
	remoteAwareness: {},
	setSidebarView: (view) => set({ sidebarView: view }),
	setCurrentMindmapId: (id) => set({ currentMindmapId: id }),
	// `mindmapId` defaults to the open map: the common caller is an edit to the
	// map on screen. A caller that publishes a tree for a map it is switching TO
	// must pass that id explicitly, before the switch has landed in the store.
	setCurrentTree: (tree, mindmapId) =>
		set((state) => ({
			currentTree: tree,
			currentTreeMindmapId: mindmapId !== undefined ? mindmapId : state.currentMindmapId,
		})),
	setMindmapList: (list) => set({ mindmapList: list }),
	addChatMessage: (msg) =>
		set((state) => ({ chatMessages: [...state.chatMessages, msg] })),
	updateLastAssistantMessage: (content) =>
		set((state) => {
			const msgs = [...state.chatMessages];
			for (let i = msgs.length - 1; i >= 0; i--) {
				if (msgs[i].role === "assistant") {
					msgs[i] = { ...msgs[i], content };
					break;
				}
			}
			return { chatMessages: msgs };
		}),
	clearChatMessages: () => set({ chatMessages: [] }),
	setFocusedNodeId: (id) => set({ focusedNodeId: id }),
	setRemoteAwareness: (byEmail) => set({ remoteAwareness: byEmail }),
	highlightedNodeIds: [],
	setHighlightedNodeIds: (ids) => set({ highlightedNodeIds: ids }),
	pendingTreeUpdate: null,
	requestTreeUpdate: (tree) => set({ pendingTreeUpdate: tree }),
	clearPendingTreeUpdate: () => set({ pendingTreeUpdate: null }),
	pendingTitleUpdate: null,
	requestTitleUpdate: (id, title) => set({ pendingTitleUpdate: { id, title } }),
	clearPendingTitleUpdate: () => set({ pendingTitleUpdate: null }),
	commentMode: false,
	setCommentMode: (v) => set({ commentMode: v }),
	remoteEditingBy: null,
	setRemoteEditingBy: (editor) => set({ remoteEditingBy: editor }),
	commentsByNodeId: {},
	setCommentsByNodeId: (byNodeId) => set({ commentsByNodeId: byNodeId }),
	commentsConnection: { status: "disconnected", connected: false, connecting: false, error: null },
	setCommentsConnection: (connection) => set((state) => {
		const current = state.commentsConnection;
		if (
			current.status === connection.status &&
			current.connected === connection.connected &&
			current.connecting === connection.connecting &&
			current.error === connection.error
		) return state;
		return { commentsConnection: connection };
	}),
	activeCommentNodeId: null,
	setActiveCommentNodeId: (nodeId) => set({ activeCommentNodeId: nodeId }),
	commentActions: noopCommentActions,
	setCommentActions: (actions) => set({ commentActions: actions }),
	imageLightbox: null,
	setImageLightbox: (state) => set({ imageLightbox: state }),
	selectedImage: null,
	setSelectedImage: (state) => set({ selectedImage: state }),
	showAttribution: true,
	setShowAttribution: (v) => set({ showAttribution: v }),
	showCanvasComments: true,
	setShowCanvasComments: (v) => set({ showCanvasComments: v }),
	nodeVersionPreview: null,
	setNodeVersionPreview: (version) => set({ nodeVersionPreview: version }),
}));
