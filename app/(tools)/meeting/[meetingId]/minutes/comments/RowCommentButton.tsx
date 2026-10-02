"use client";

import { useState } from "react";
import { MessageSquarePlus, MessageSquareText } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CommentEntry } from "./CommentEntry";
import { useMinutesCommentsApi } from "./MinutesCommentsContext";

/** Comment affordance for one matter/row of the Minutes table. Shows an
 *  unresolved-count badge when the row has open comments, and a hover-only
 *  "add comment" icon otherwise. Renders nothing when comments are
 *  unavailable (public link). Hidden in print. */
export function RowCommentButton({ anchorId, className = "" }: { anchorId: string; className?: string }) {
  const api = useMinutesCommentsApi();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  if (!api) return null;

  const threads = api.threads.get(anchorId) ?? [];
  const unresolved = threads.reduce((n, t) => n + (t.comment.resolved ? 0 : 1) + t.replies.filter((r) => !r.resolved).length, 0);
  const total = threads.length;

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    const ok = await api.add(anchorId, body, replyTo ?? undefined);
    if (!ok) setDraft(body);
    else setReplyTo(null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={total ? `${unresolved} unresolved comments` : "Add comment"}
          title={total ? `${unresolved} unresolved of ${total}` : "Add comment"}
          className={`inline-flex items-center gap-0.5 rounded p-1 text-xs transition-opacity print:hidden ${
            unresolved > 0
              ? "bg-primary/15 font-semibold text-primary"
              : total > 0
                ? "text-muted-foreground"
                : `text-muted-foreground hover:bg-muted md:opacity-0 md:focus:opacity-100 md:group-hover/row:opacity-100 md:group-hover/matter:opacity-100 ${open ? "md:opacity-100" : ""}`
          } ${className}`}
        >
          {total > 0 ? <MessageSquareText className="h-3.5 w-3.5" /> : <MessageSquarePlus className="h-3.5 w-3.5" />}
          {total > 0 && <span>{unresolved || total}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0 print:hidden" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex max-h-80 flex-col gap-3 overflow-y-auto p-3">
          {threads.length === 0 && <p className="text-xs text-muted-foreground">No comments yet. Start the discussion on this row.</p>}
          {threads.map(({ comment, replies }) => (
            <div key={comment.id} className="flex flex-col gap-2 rounded-md border border-border p-2">
              <CommentEntry
                comment={comment}
                viewerEmail={api.viewerEmail}
                isOwner={api.isOwner}
                showResolve
                onEdit={(body) => void api.edit(comment.id, body)}
                onResolve={(resolved) => void api.setResolved(comment.id, resolved)}
                onDelete={() => void api.remove(comment.id)}
              />
              {replies.map((reply) => (
                <div key={reply.id} className="ml-3 border-l border-border pl-2">
                  <CommentEntry
                    comment={reply}
                    viewerEmail={api.viewerEmail}
                    isOwner={api.isOwner}
                    showResolve={false}
                    onEdit={(body) => void api.edit(reply.id, body)}
                    onResolve={() => undefined}
                    onDelete={() => void api.remove(reply.id)}
                  />
                </div>
              ))}
              <button type="button" className="self-start text-xs font-medium text-muted-foreground hover:text-primary" onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}>
                {replyTo === comment.id ? "Cancel reply" : "Reply"}
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 border-t border-border p-3">
          {replyTo && <span className="text-xs text-muted-foreground">Replying to a thread</span>}
          <textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={replyTo ? "Write a reply…" : "Write a comment…"}
            className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Ctrl/⌘ + Enter to send</span>
            <button type="button" disabled={!draft.trim()} onClick={() => void submit()} className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
              {replyTo ? "Reply" : "Comment"}
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
