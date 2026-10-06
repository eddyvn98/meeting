"use client";

import { useState } from "react";
import { Check, Pencil, RotateCcw, Trash2 } from "lucide-react";
import type { MinutesComment } from "./types";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

/** One comment (top-level or reply): author, age, body, and the actions the
 *  viewer is allowed — resolve/reopen for everyone, edit for the author,
 *  delete for the author or the meeting owner. */
export function CommentEntry({
  comment,
  viewerEmail,
  isOwner,
  showResolve,
  onEdit,
  onResolve,
  onDelete,
}: {
  comment: MinutesComment;
  viewerEmail: string;
  isOwner: boolean;
  showResolve: boolean;
  onEdit: (body: string) => void;
  onResolve: (resolved: boolean) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const isAuthor = comment.authorEmail.toLowerCase() === viewerEmail.toLowerCase();
  const iconBtn = "rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

  const save = () => {
    const next = draft.trim();
    if (next && next !== comment.body) onEdit(next);
    setEditing(false);
  };

  return (
    <div className={`flex flex-col gap-1 ${comment.resolved ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-xs">
          <span className="font-semibold text-foreground">{comment.authorEmail}</span>
          <span className="ml-1.5 text-muted-foreground">{timeAgo(comment.createdAt)}</span>
        </div>
        <div className="flex shrink-0 items-center">
          {showResolve && (
            <button type="button" className={iconBtn} title={comment.resolved ? "Reopen" : "Resolve"} aria-label={comment.resolved ? "Reopen comment" : "Resolve comment"} onClick={() => onResolve(!comment.resolved)}>
              {comment.resolved ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
            </button>
          )}
          {isAuthor && (
            <button type="button" className={iconBtn} title="Edit" aria-label="Edit comment" onClick={() => { setDraft(comment.body); setEditing(true); }}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {(isAuthor || isOwner) && (
            <button type="button" className={`${iconBtn} hover:text-red-600`} title="Delete" aria-label="Delete comment" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {editing ? (
        <div className="flex flex-col gap-1">
          <textarea
            autoFocus
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full resize-none rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-brand-orange"
          />
          <div className="flex justify-end gap-1.5">
            <button type="button" className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted" onClick={() => setEditing(false)}>Cancel</button>
            <button type="button" className="rounded bg-brand-orange px-2 py-0.5 text-xs font-medium text-white hover:opacity-90" onClick={save}>Save</button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">{comment.body}</p>
      )}
    </div>
  );
}
