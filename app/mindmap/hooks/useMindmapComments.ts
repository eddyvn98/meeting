"use client";

/**
 * app/mindmap/hooks/useMindmapComments.ts
 *
 * Owns the lifecycle of the dedicated comments WebSocket channel
 * (lib/mindmap/comments-client.ts -> docker/mindmap-ws/src/comments-channel.js)
 * and projects incoming messages into React state grouped by nodeId, for
 * the comment badge/composer/panel UI.
 *
 * Mirrors useMindmapRealtime.ts's token-fetch + mock-email pattern (same
 * POST /api/mindmaps/[mindmapId]/ws-token route — the token isn't scoped to
 * a specific channel path, just the mindmapId claim) so both channels
 * authenticate identically. Fails soft: if NEXT_PUBLIC_MINDMAP_WS_URL isn't
 * configured or the token fetch fails, comments simply stay empty rather
 * than breaking the editor.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  connectMindmapComments,
  type CommentsClientConnectionState,
  type MindmapComment,
  type CommentsClientHandle,
} from "@/lib/mindmap/comments-client";
import { getMindmapDeletionSignal, isMindmapDeleted } from "./mindmapDeletionState";

export type CommentsByNodeId = Record<string, MindmapComment[]>;

export type MindmapCommentsStatus = "disconnected" | "connected" | "connecting" | "error";

export interface MindmapCommentsConnectionState {
  status: MindmapCommentsStatus;
  connected: boolean;
  connecting: boolean;
  error: string | null;
}

const DISCONNECTED_STATE: MindmapCommentsConnectionState = {
  status: "disconnected",
  connected: false,
  connecting: false,
  error: null,
};

function groupByNodeId(comments: MindmapComment[]): CommentsByNodeId {
  const grouped: CommentsByNodeId = {};
  for (const comment of comments) {
    (grouped[comment.nodeId] ??= []).push(comment);
  }
  for (const list of Object.values(grouped)) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return grouped;
}

export function useMindmapComments(mindmapId: string | null) {
  const { data: session } = useSession();
  const clientRef = useRef<CommentsClientHandle | null>(null);
  const [commentsByNodeId, setCommentsByNodeId] = useState<CommentsByNodeId>({});
  const [connection, setConnection] = useState<MindmapCommentsConnectionState>(DISCONNECTED_STATE);

  const getMockEmail = () => {
    if (typeof document === "undefined") return null;
    const match = document.cookie.match(/(?:^|; )mock-email=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
  };
  const mockEmail = getMockEmail();

  useEffect(() => {
    let cancelled = false;
    let allComments: MindmapComment[] = [];
    setCommentsByNodeId({});
    setConnection(DISCONNECTED_STATE);

    const userEmail = (process.env.NODE_ENV !== "production" && mockEmail) ? mockEmail : session?.user?.email;
    const wsBaseUrl = process.env.NEXT_PUBLIC_MINDMAP_WS_URL;
    if (!mindmapId || mindmapId.startsWith("mm_") || !userEmail || isMindmapDeleted(mindmapId)) return;
    if (!wsBaseUrl) {
      const message = "Comments realtime is not configured (NEXT_PUBLIC_MINDMAP_WS_URL is missing)";
      console.error("[mindmap] comments channel configuration error:", message);
      setConnection({ status: "error", connected: false, connecting: false, error: message });
      return;
    }
    setConnection({ status: "connecting", connected: false, connecting: true, error: null });

    const rerender = () => setCommentsByNodeId(groupByNodeId(allComments));

    (async () => {
      try {
        const res = await fetch(`/api/mindmaps/${encodeURIComponent(mindmapId)}/ws-token`, { method: "POST", signal: getMindmapDeletionSignal(mindmapId) });
        if (!res.ok) throw new Error(`Comments realtime token request failed (${res.status})`);
        if (cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if (!data.token) throw new Error("Comments realtime token response was invalid");

        const refreshToken = async () => {
          try {
            if (isMindmapDeleted(mindmapId)) return null;
            const refreshed = await fetch(`/api/mindmaps/${encodeURIComponent(mindmapId)}/ws-token`, { method: "POST", signal: getMindmapDeletionSignal(mindmapId) });
            if (!refreshed.ok) return null;
            const nextData = await refreshed.json();
            return typeof nextData.token === "string" ? nextData.token : null;
          } catch {
            return null;
          }
        };

        const client = connectMindmapComments(data.wsUrl ?? wsBaseUrl, mindmapId, data.token, {
          onInit: (comments) => {
            allComments = comments;
            rerender();
          },
          onCreated: (comment) => {
            allComments = [...allComments, comment];
            rerender();
          },
          onUpdated: (comment) => {
            allComments = allComments.map((c) => (c.id === comment.id ? comment : c));
            rerender();
          },
          onResolved: (comment) => {
            allComments = allComments.map((c) => (c.id === comment.id ? comment : c));
            rerender();
          },
          onThreadResolved: (commentIds, resolved) => {
            const ids = new Set(commentIds);
            allComments = allComments.map((c) => (ids.has(c.id) ? { ...c, resolved } : c));
            rerender();
          },
          onDeleted: (commentId) => {
            allComments = allComments.filter((c) => c.id !== commentId);
            rerender();
          },
          onDeletedMany: (commentIds) => {
            const deletedIds = new Set(commentIds);
            allComments = allComments.filter((comment) => !deletedIds.has(comment.id));
            rerender();
          },
          onStatusChange: (state: CommentsClientConnectionState) => {
            if (!cancelled) setConnection(state);
          },
          onError: (message) => {
            console.error("[mindmap] comments channel error:", message);
            if (!cancelled) {
              setConnection((current) => ({ ...current, error: message }));
            }
          },
        }, refreshToken);
        clientRef.current = client;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Comments realtime connection failed";
        console.error("[mindmap] comments channel connection failed:", err);
        if (!cancelled) {
          setConnection({ status: "error", connected: false, connecting: false, error: message });
        }
      }
    })();

    return () => {
      cancelled = true;
      clientRef.current?.close();
      clientRef.current = null;
      setConnection(DISCONNECTED_STATE);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mindmapId, session?.user?.email, mockEmail]);

  const addComment = useCallback((nodeId: string, body: string, parentCommentId?: string | null) => {
    clientRef.current?.addComment(nodeId, body, parentCommentId);
  }, []);

  const resolveComment = useCallback((commentId: string, resolved: boolean) => {
    clientRef.current?.resolveComment(commentId, resolved);
  }, []);

  const resolveThread = useCallback((commentId: string, resolved: boolean) => {
    clientRef.current?.resolveThread(commentId, resolved);
  }, []);

  const updateComment = useCallback((commentId: string, body: string) => {
    clientRef.current?.updateComment(commentId, body);
  }, []);

  const deleteComment = useCallback((commentId: string) => {
    clientRef.current?.deleteComment(commentId);
  }, []);

  return {
    ...connection,
    connection,
    commentsByNodeId,
    addComment,
    updateComment,
    resolveComment,
    resolveThread,
    deleteComment,
  };
}
