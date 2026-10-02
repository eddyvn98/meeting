"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { popUndoAction, pushUndoAction, removeUndoAction, type UndoAction } from "@/lib/meeting/undoStack";

const UNDO_TOAST_MS = 6000;

/**
 * Wires the pure undoStack.ts helpers into a per-hook-instance in-memory
 * stack, a sonner "Undo" toast on every recorded action, and a global
 * Ctrl/Cmd+Z shortcut (ignored while focus is inside an input/textarea, so
 * it doesn't fight the browser's own text-field undo). Used by both
 * useOverviewSectionsEditor.ts and useMinutesEditor.ts — each editor calls
 * `record(label, undo)` right after a mutation it wants undoable succeeds.
 *
 * `undo()` closures re-send the pre-mutation value the same way a fresh
 * edit would (see each editor's call sites) — they never go back through
 * `record`, so replaying one never pushes a new undo entry.
 */
export function useUndoManager() {
  const stackRef = useRef<UndoAction[]>([]);

  const runAction = useCallback(async (action: UndoAction) => {
    await action.run();
  }, []);

  const record = useCallback(
    (label: string, run: () => void | Promise<void>) => {
      const action: UndoAction = {
        id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        run,
      };
      stackRef.current = pushUndoAction(stackRef.current, action);
      toast.success(label, {
        duration: UNDO_TOAST_MS,
        action: {
          label: "Undo",
          onClick: () => {
            stackRef.current = removeUndoAction(stackRef.current, action.id);
            void runAction(action);
          },
        },
      });
    },
    [runAction],
  );

  const undoLast = useCallback(() => {
    const { action, stack } = popUndoAction(stackRef.current);
    stackRef.current = stack;
    if (action) void runAction(action);
  }, [runAction]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "z" || !(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      undoLast();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undoLast]);

  return { record };
}
