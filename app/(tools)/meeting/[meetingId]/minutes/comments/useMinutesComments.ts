"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MinutesCommentsApi, MinutesComment, MinutesCommentThread } from "./types";

const POLL_INTERVAL_MS = 5_000;

/** Loads a meeting's Minutes-row comments and keeps them fresh by polling
 *  (there is no comments realtime channel). Every mutation refetches so the
 *  UI always reflects the server. Returns null-safe empty state on failure. */
export function useMinutesComments(meetingId: string): MinutesCommentsApi {
  const [comments, setComments] = useState<MinutesComment[]>([]);
  const [viewerEmail, setViewerEmail] = useState("");
  const [isOwner, setIsOwner] = useState(false);

  const base = `/api/meeting/${meetingId}/comments`;

  const refresh = useCallback(async () => {
    if (!meetingId) return;
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { comments: MinutesComment[]; viewerEmail: string; role: string };
      setComments(data.comments);
      setViewerEmail(data.viewerEmail);
      setIsOwner(data.role === "owner");
    } catch {
      // Best-effort: keep the last known comments.
    }
  }, [base, meetingId]);

  useEffect(() => {
    void refresh();
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  const send = useCallback(
    async (url: string, method: string, body?: unknown) => {
      try {
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        await refresh();
        return res.ok;
      } catch {
        return false;
      }
    },
    [refresh],
  );

  const threads = useMemo(() => {
    const byAnchor = new Map<string, MinutesCommentThread[]>();
    const replies = new Map<string, MinutesComment[]>();
    for (const c of comments) {
      if (c.parentId) replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), c]);
    }
    for (const c of comments) {
      if (c.parentId) continue;
      byAnchor.set(c.anchorId, [...(byAnchor.get(c.anchorId) ?? []), { comment: c, replies: replies.get(c.id) ?? [] }]);
    }
    return byAnchor;
  }, [comments]);

  return {
    threads,
    viewerEmail,
    isOwner,
    add: (anchorId, body, parentId) => send(base, "POST", { anchorId, body, parentId }),
    edit: (id, body) => send(`${base}/${id}`, "PATCH", { body }),
    setResolved: (id, resolved) => send(`${base}/${id}`, "PATCH", { resolved }),
    remove: (id) => send(`${base}/${id}`, "DELETE"),
  };
}
