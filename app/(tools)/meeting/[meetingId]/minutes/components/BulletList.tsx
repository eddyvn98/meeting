"use client";

import { useEffect, useRef, useState } from "react";
import { AutoTextarea, cellTextClass, isPlainEnter } from "./AutoTextarea";

/** The "Matter Discussed" cell for one row: one wrapped, click-to-edit line per
 *  bullet. Enter splits the line at the caret into a new bullet, Backspace on an
 *  empty bullet removes it, and leaving an empty bullet drops it. Backspace on
 *  the only, empty bullet calls `onEmptyBackspace` (the row uses it to remove
 *  itself when nothing else in the row is filled in). */
export function BulletList({
  bullets,
  canEdit,
  onChange,
  onEmptyBackspace,
}: {
  bullets: string[];
  canEdit: boolean;
  onChange: (next: string[]) => void;
  onEmptyBackspace?: () => void;
}) {
  const refs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const [focusAt, setFocusAt] = useState<{ index: number; caret: "start" | "end" } | null>(null);

  useEffect(() => {
    if (!focusAt) return;
    const el = refs.current[focusAt.index];
    if (el) {
      el.focus();
      const pos = focusAt.caret === "start" ? 0 : el.value.length;
      el.setSelectionRange(pos, pos);
    }
    setFocusAt(null);
  }, [focusAt]);

  const visible = bullets.filter((b) => b.trim() !== "");
  if (!canEdit) {
    if (visible.length === 0) return <span className="text-sm text-muted-foreground">—</span>;
    return (
      <ul className="list-disc space-y-0.5 whitespace-pre-wrap break-words pl-4 text-sm">
        {visible.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    );
  }

  const items = bullets.length > 0 ? bullets : [""];
  const set = (index: number, text: string) => onChange(items.map((x, j) => (j === index ? text : x)));

  return (
    <>
      <ul className="flex flex-col gap-0.5 print:hidden">
        {items.map((b, i) => (
          <li key={i} className="flex items-start gap-1">
            <span className="select-none pt-0.5 text-muted-foreground">•</span>
            <AutoTextarea
              ref={(el) => {
                refs.current[i] = el;
              }}
              className={cellTextClass}
              value={b}
              placeholder={i === 0 ? "Type here…" : undefined}
              onChange={(e) => set(i, e.target.value)}
              onKeyDown={(e) => {
                if (isPlainEnter(e)) {
                  e.preventDefault();
                  const at = e.currentTarget.selectionStart;
                  const next = [...items];
                  next.splice(i, 1, b.slice(0, at), b.slice(at));
                  onChange(next);
                  setFocusAt({ index: i + 1, caret: "start" });
                } else if (e.key === "Backspace" && b === "") {
                  e.preventDefault();
                  if (items.length > 1) {
                    onChange(items.filter((_, j) => j !== i));
                    setFocusAt({ index: Math.max(0, i - 1), caret: "end" });
                  } else {
                    onEmptyBackspace?.();
                  }
                }
              }}
              onBlur={() => {
                if (b.trim() === "" && items.length > 1) onChange(items.filter((_, j) => j !== i));
              }}
            />
          </li>
        ))}
      </ul>
      {visible.length > 0 ? (
        <ul className="hidden list-disc space-y-0.5 whitespace-pre-wrap break-words pl-4 text-sm print:block">
          {visible.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      ) : (
        <span className="hidden text-sm text-muted-foreground print:inline">—</span>
      )}
    </>
  );
}
