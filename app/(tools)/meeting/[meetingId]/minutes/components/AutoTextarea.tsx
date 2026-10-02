"use client";

import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent, type TextareaHTMLAttributes } from "react";

/** Wrapped, auto-growing text cell: shows the full text on as many lines as it needs. */
export const cellTextClass =
  "block w-full resize-none overflow-hidden whitespace-pre-wrap break-words rounded border border-transparent bg-transparent px-1 py-0.5 text-sm leading-snug outline-none read-only:cursor-default focus:border-primary focus:bg-background print:border-none";

/** True for an Enter press that should act as a "new line" command — not
 *  Shift+Enter, and not the Enter that confirms an IME composition (Vietnamese
 *  Telex/VNI, Chinese, Japanese input). */
export function isPlainEnter(e: KeyboardEvent<HTMLElement>): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing;
}

export const AutoTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function AutoTextarea(
  { className, onInput, value, defaultValue, ...props },
  forwardedRef,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const resize = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const setRefs = useCallback(
    (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    },
    [forwardedRef],
  );

  useLayoutEffect(resize, [resize, value, defaultValue]);

  // Re-wrap when the column width changes (window resize, sidebar toggle).
  useEffect(() => {
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== lastWidth) {
        lastWidth = el.clientWidth;
        resize();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [resize]);

  return (
    <textarea
      ref={setRefs}
      rows={1}
      value={value}
      defaultValue={defaultValue}
      className={className ?? cellTextClass}
      onInput={(e) => {
        resize();
        onInput?.(e);
      }}
      {...props}
    />
  );
});
