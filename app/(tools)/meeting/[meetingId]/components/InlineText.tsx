"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

/** Looks exactly like the surrounding text until hovered or focused, when it
 *  gets a faint background — no border, no edit-mode toggle. Font, size, colour
 *  and weight are inherited from the parent element. */
const inlineTextClass =
  "m-0 block w-[calc(100%+0.5rem)] max-w-none -mx-1 resize-none overflow-hidden whitespace-pre-wrap break-words rounded border-0 bg-transparent px-1 py-0 text-inherit outline-none [font:inherit] placeholder:text-muted-foreground/60 hover:bg-muted/60 focus:bg-muted/60";

/** True for an Enter that means "new line / next item": not Shift+Enter and not
 *  the Enter that confirms an IME composition (Vietnamese Telex/VNI, CJK). */
function isPlainEnter(e: KeyboardEvent<HTMLElement>): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing;
}

/**
 * Click-to-edit, auto-growing, wrapped text. `onCommit` fires on blur when the
 * text changed. Enter calls `onEnter(text)` (or just commits when it is not
 * given), Backspace on an empty field calls `onBackspaceEmpty`, and Escape
 * reverts the draft.
 */
export function InlineText({
  value,
  onCommit,
  onEnter,
  onBackspaceEmpty,
  placeholder,
  autoFocus,
  selectOnFocus,
  className,
  ariaLabel,
}: {
  value: string;
  onCommit: (text: string) => void;
  onEnter?: (text: string) => void;
  onBackspaceEmpty?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  selectOnFocus?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  // The last text handed to the parent, so Enter-then-blur never commits twice.
  const committed = useRef(value);

  useEffect(() => {
    setDraft(value);
    committed.current = value;
  }, [value]);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useLayoutEffect(resize, [resize, draft]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        resize();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [resize]);

  useEffect(() => {
    if (autoFocus && selectOnFocus) ref.current?.select();
  }, [autoFocus, selectOnFocus]);

  const commit = (text: string) => {
    if (text === committed.current) return;
    committed.current = text;
    onCommit(text);
  };

  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      aria-label={ariaLabel}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className={`${inlineTextClass} ${className ?? ""}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (isPlainEnter(e)) {
          e.preventDefault();
          if (onEnter) {
            onEnter(draft);
            committed.current = draft;
          } else {
            e.currentTarget.blur();
          }
        } else if (e.key === "Backspace" && draft === "" && onBackspaceEmpty) {
          e.preventDefault();
          onBackspaceEmpty();
        } else if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
