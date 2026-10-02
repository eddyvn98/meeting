/**
 * lib/mindmap/comments-client.ts
 *
 * Thin native-WebSocket client for mindmap-ws's dedicated comments channel
 * (docker/mindmap-ws/src/comments-channel.js), at path
 * `/comments/:mindmapId` — deliberately NOT the Yjs `WebsocketProvider`
 * used by lib/mindmap/ydoc.ts, since comments are a separate plain-JSON
 * protocol, not part of the Y.Doc (see comments-channel.js's header for
 * why). Reuses the same short-lived connect JWT already minted by
 * POST /api/mindmaps/[mindmapId]/ws-token — that route's token only claims
 * mindmapId/userEmail/role, not which path it's used on, so no new token
 * route is needed.
 */

/**
 * Sentinel `nodeId` for a comment about the whole canvas rather than any one
 * node — the schema requires a nodeId (MindmapComment.nodeId is non-null),
 * and nothing server-side validates it against the real node tree except
 * when a reply's parentCommentId is present (see comments-store.js's
 * createComment), so a fixed placeholder id works without a schema change.
 * Never a real node id (mindmap node ids come from the tree/Yjs, never this
 * literal string), so it can't collide.
 */
export const CANVAS_COMMENT_NODE_ID = "__canvas__";

export interface MindmapComment {
  id: string;
  mindmapId: string;
  nodeId: string;
  parentCommentId: string | null;
  authorEmail: string;
  body: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

type ServerMessage =
  | { type: "comments.init"; comments: MindmapComment[] }
  | { type: "comment.created"; comment: MindmapComment }
  | { type: "comment.updated"; comment: MindmapComment }
  | { type: "comment.resolved"; comment: MindmapComment }
  | { type: "comment.threadResolved"; commentIds: string[]; resolved: boolean }
  | { type: "comment.deleted"; commentId: string; commentIds?: string[] }
  | { type: "error"; message: string };

export interface CommentsClientHandlers {
  onInit?: (comments: MindmapComment[]) => void;
  onCreated?: (comment: MindmapComment) => void;
  onUpdated?: (comment: MindmapComment) => void;
  onResolved?: (comment: MindmapComment) => void;
  onThreadResolved?: (commentIds: string[], resolved: boolean) => void;
  onDeleted?: (commentId: string) => void;
  onDeletedMany?: (commentIds: string[]) => void;
  onError?: (message: string) => void;
  onStatusChange?: (state: CommentsClientConnectionState) => void;
}

export type CommentsClientConnectionStatus = "connected" | "connecting" | "error";

export interface CommentsClientConnectionState {
  status: CommentsClientConnectionStatus;
  connected: boolean;
  connecting: boolean;
  error: string | null;
}

export interface CommentsClientHandle {
  addComment: (nodeId: string, body: string, parentCommentId?: string | null) => void;
  updateComment: (commentId: string, body: string) => void;
  resolveComment: (commentId: string, resolved: boolean) => void;
  resolveThread: (commentId: string, resolved: boolean) => void;
  deleteComment: (commentId: string) => void;
  /** Closes the connection. Safe to call multiple times. */
  close: () => void;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 8_000;
const OPEN_STATE = 1;

/**
 * @param wsUrl - ws:// or wss:// base URL of the mindmap-ws service, e.g. NEXT_PUBLIC_MINDMAP_WS_URL
 * @param mindmapId
 * @param token - the same connect JWT used for the Yjs sync connection
 * @param handlers
 * @param refreshToken - mints a replacement connect token (see
 *   lib/mindmap/ws-token.ts — they expire in 60s). Without this, any
 *   reconnect after the token has aged out (a viewer idling on the comments
 *   panel is the common case, since nothing else on that tab talks to
 *   mindmap-ws to incidentally refresh it) is refused by the server and the
 *   client burns through MAX_RECONNECT_ATTEMPTS retrying with the same stale
 *   token, landing on "reconnect attempts exhausted". Mirrors
 *   lib/mindmap/ydoc.ts's refreshConnectToken for the Yjs sync connection.
 */
export function connectMindmapComments(
  wsUrl: string,
  mindmapId: string,
  token: string,
  handlers: CommentsClientHandlers,
  refreshToken?: () => Promise<string | null>,
): CommentsClientHandle {
  const base = `${wsUrl.replace(/\/$/, "")}/comments/${encodeURIComponent(mindmapId)}`;
  let currentToken = token;
  const buildUrl = () => `${base}?token=${encodeURIComponent(currentToken)}`;
  const pendingMessages: object[] = [];
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let stopped = false;

  const notifyStatus = (status: CommentsClientConnectionStatus, error: string | null = null) => {
    handlers.onStatusChange?.({
      status,
      connected: status === "connected",
      connecting: status === "connecting",
      error,
    });
  };

  const reportError = (message: string) => {
    handlers.onError?.(message);
    notifyStatus("error", message);
  };

  const flushPendingMessages = (socket: WebSocket) => {
    while (!stopped && ws === socket && socket.readyState === OPEN_STATE && pendingMessages.length > 0) {
      const payload = pendingMessages[0];
      try {
        socket.send(JSON.stringify(payload));
        pendingMessages.shift();
      } catch {
        reportError("Comments realtime could not send a queued action");
        try {
          socket.close();
        } catch {
          // The close event will schedule the next retry when available.
        }
        return;
      }
    }
  };

  const scheduleReconnect = (reason: string) => {
    if (stopped || reconnectTimer) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      notifyStatus("error", `${reason}; reconnect attempts exhausted`);
      return;
    }

    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts,
      RECONNECT_MAX_DELAY_MS,
    );
    reconnectAttempts += 1;
    notifyStatus("connecting", reason);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      // A dropped connection may have sat idle long enough for the 60s
      // connect token to expire (e.g. a viewer just reading the comments
      // panel); mint a fresh one before retrying, or the server will refuse
      // every remaining attempt for the same reason and we'll exhaust the
      // retry budget on a problem a new token would have avoided.
      if (refreshToken) {
        void refreshToken().then((next) => {
          if (next) currentToken = next;
          openSocket();
        });
      } else {
        openSocket();
      }
    }, delay);
  };

  function openSocket() {
    if (stopped) return;
    notifyStatus("connecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(buildUrl());
    } catch {
      const message = "Comments realtime could not open a WebSocket";
      reportError(message);
      scheduleReconnect(message);
      return;
    }
    ws = socket;

    socket.addEventListener("open", () => {
      if (stopped || ws !== socket) return;
      reconnectAttempts = 0;
      notifyStatus("connected");
      flushPendingMessages(socket);
    });

    socket.addEventListener("message", (event) => {
      if (stopped || ws !== socket) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(typeof event.data === "string" ? event.data : "");
      } catch {
        reportError("Comments realtime returned an invalid message");
        return;
      }
      switch (msg.type) {
        case "comments.init":
          handlers.onInit?.(msg.comments);
          return;
        case "comment.created":
          handlers.onCreated?.(msg.comment);
          return;
        case "comment.updated":
          handlers.onUpdated?.(msg.comment);
          return;
        case "comment.resolved":
          handlers.onResolved?.(msg.comment);
          return;
        case "comment.threadResolved":
          handlers.onThreadResolved?.(msg.commentIds, msg.resolved);
          return;
        case "comment.deleted":
          if (msg.commentIds?.length) handlers.onDeletedMany?.(msg.commentIds);
          else handlers.onDeleted?.(msg.commentId);
          return;
        case "error":
          handlers.onError?.(msg.message);
          return;
        default:
          reportError("Comments realtime returned an unknown message");
      }
    });

    socket.addEventListener("error", () => {
      if (stopped || ws !== socket) return;
      reportError("Comments realtime WebSocket error");
    });

    socket.addEventListener("close", (event) => {
      if (stopped || ws !== socket) return;
      ws = null;
      const reason = event.reason?.trim();
      const message = `Comments realtime connection closed (code ${event.code}${reason ? `: ${reason}` : ""})`;
      reportError(message);
      scheduleReconnect(message);
    });
  }

  const send = (payload: object) => {
    pendingMessages.push(payload);
    if (ws?.readyState === OPEN_STATE) flushPendingMessages(ws);
  };

  openSocket();

  return {
    addComment: (nodeId, body, parentCommentId = null) =>
      send({ type: "comment.add", nodeId, body, parentCommentId }),
    updateComment: (commentId, body) => send({ type: "comment.update", commentId, body }),
    resolveComment: (commentId, resolved) => send({ type: "comment.resolve", commentId, resolved }),
    resolveThread: (commentId, resolved) => send({ type: "comment.resolveThread", commentId, resolved }),
    deleteComment: (commentId) => send({ type: "comment.delete", commentId }),
    close: () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      const socket = ws;
      ws = null;
      try {
        socket?.close();
      } catch {
        // Cleanup must remain safe even if the browser already closed it.
      }
    },
  };
}
