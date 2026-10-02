"use client";

import { useEffect, useRef, useState } from "react";
import type { MinutesActionItem } from "@/lib/meeting/overviewSections";
import { formatActionParenthetical } from "@/lib/meeting/minutesFormat";
import { AutoTextarea, cellTextClass, isPlainEnter } from "./AutoTextarea";

const metaInput = "w-full min-w-0 rounded border border-border bg-background px-1.5 py-0.5 text-xs outline-none focus:border-primary";

function generateId(): string {
  return `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function newAction(text = ""): MinutesActionItem {
  return { id: generateId(), text, duration: null, deadline: null, ongoing: false };
}

/** Read-only rendering: action text followed by its italic-bold
 *  "(Duration, Deadline)" / "(Ongoing)" parenthetical, per the MOM layout
 *  spec. */
function ActionDisplay({ action, ongoingLabel }: { action: MinutesActionItem; ongoingLabel: string }) {
  const suffix = formatActionParenthetical(action, ongoingLabel);
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {action.text}
      {suffix && <span className="italic font-bold"> {suffix}</span>}
    </p>
  );
}

/** The "Action to be taken (Duration, Deadline)" table cell for one row: one
 *  wrapped, click-to-edit line per action. Enter splits into a new action,
 *  Backspace on an empty action removes it, and the duration / deadline /
 *  ongoing fields appear under an action while it is focused (or when set). */
export function ActionCell({ actions, canEdit, ongoingLabel = "Ongoing", onChange }: { actions: MinutesActionItem[]; canEdit: boolean; ongoingLabel?: string; onChange: (next: MinutesActionItem[]) => void }) {
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [focusId, setFocusId] = useState<{ id: string; caret: "start" | "end" } | null>(null);

  useEffect(() => {
    if (!focusId) return;
    const el = refs.current[focusId.id];
    if (el) {
      el.focus();
      const pos = focusId.caret === "start" ? 0 : el.value.length;
      el.setSelectionRange(pos, pos);
    }
    setFocusId(null);
  }, [focusId]);

  const placeholder = useRef(newAction()).current;
  const visible = actions.filter((a) => a.text.trim() !== "");
  if (!canEdit) {
    if (visible.length === 0) return <span className="text-sm text-muted-foreground">—</span>;
    return (
      <div className="flex flex-col gap-1">
        {visible.map((a) => (
          <ActionDisplay key={a.id} action={a} ongoingLabel={ongoingLabel} />
        ))}
      </div>
    );
  }

  const items = actions.length > 0 ? actions : [placeholder];
  const update = (id: string, next: MinutesActionItem) => onChange(items.map((a) => (a.id === id ? next : a)));

  return (
    <>
      <div className="flex flex-col gap-1 print:hidden">
        {items.map((a, i) => {
        const hasMeta = a.ongoing || Boolean(a.duration) || Boolean(a.deadline);
        return (
          <div key={a.id} className="group flex flex-col gap-0.5">
            <AutoTextarea
              ref={(el) => {
                refs.current[a.id] = el;
              }}
              className={cellTextClass}
              value={a.text}
              placeholder={i === 0 ? "Add action…" : undefined}
              onChange={(e) => update(a.id, { ...a, text: e.target.value })}
              onKeyDown={(e) => {
                if (isPlainEnter(e)) {
                  e.preventDefault();
                  const at = e.currentTarget.selectionStart;
                  const created = newAction(a.text.slice(at));
                  const next = [...items];
                  next.splice(i, 1, { ...a, text: a.text.slice(0, at) }, created);
                  onChange(next);
                  setFocusId({ id: created.id, caret: "start" });
                } else if (e.key === "Backspace" && a.text === "" && items.length > 1) {
                  e.preventDefault();
                  onChange(items.filter((x) => x.id !== a.id));
                  const prev = items[Math.max(0, i - 1)];
                  setFocusId({ id: prev.id, caret: "end" });
                }
              }}
              onBlur={(e) => {
                // Keep the action's meta fields reachable: only drop an empty
                // action when focus is not moving into its own meta row.
                if (a.text.trim() === "" && items.length > 1 && !e.currentTarget.closest(".group")?.contains(e.relatedTarget as Node | null)) {
                  onChange(items.filter((x) => x.id !== a.id));
                }
              }}
            />
            <div className={`${hasMeta ? "flex" : "hidden group-focus-within:flex"} flex-wrap items-center gap-1 pl-1 print:hidden`}>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={a.ongoing} onChange={(e) => update(a.id, { ...a, ongoing: e.target.checked })} />
                Ongoing
              </label>
              {!a.ongoing && (
                <>
                  <input className={`${metaInput} flex-1`} value={a.duration ?? ""} onChange={(e) => update(a.id, { ...a, duration: e.target.value || null })} placeholder="Duration" />
                  <input className={`${metaInput} flex-1`} value={a.deadline ?? ""} onChange={(e) => update(a.id, { ...a, deadline: e.target.value || null })} placeholder="Deadline" />
                </>
              )}
            </div>
          </div>
        );
        })}
      </div>
      <div className="hidden flex-col gap-1 print:flex">
        {visible.length > 0 ? visible.map((a) => <ActionDisplay key={a.id} action={a} ongoingLabel={ongoingLabel} />) : <span className="text-sm text-muted-foreground">—</span>}
      </div>
    </>
  );
}
