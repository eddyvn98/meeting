/**
 * Pure, framework-free undo stack used by the Overview and Minutes editors
 * (see useOverviewSectionsEditor.ts / useMinutesEditor.ts, wired to React +
 * sonner by useUndoManager.ts). Kept side-effect free so it's trivially unit
 * tested — the caller supplies each entry's `run()` closure and owns what
 * "undo" actually does (re-sending the previous value to the API).
 */
export interface UndoAction {
  id: string;
  run: () => void | Promise<void>;
}

/** How many recent actions are kept — oldest is dropped once the stack
 *  grows past this so a long editing session can't grow it unbounded. */
export const UNDO_STACK_LIMIT = 20;

/** Appends `action`, dropping the oldest entry/entries once the stack
 *  exceeds `limit`. Returns a new array; never mutates `stack`. */
export function pushUndoAction(stack: UndoAction[], action: UndoAction, limit = UNDO_STACK_LIMIT): UndoAction[] {
  const next = [...stack, action];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** Pops the most recently pushed action (LIFO), used by the Ctrl/Cmd+Z
 *  shortcut. Returns `{ action: undefined, stack }` (the same, empty-safe
 *  array) when the stack is empty. */
export function popUndoAction(stack: UndoAction[]): { action: UndoAction | undefined; stack: UndoAction[] } {
  if (stack.length === 0) return { action: undefined, stack };
  return { action: stack[stack.length - 1], stack: stack.slice(0, -1) };
}

/** Removes one action by id regardless of its position, used when a specific
 *  toast's own "Undo" button is clicked instead of the keyboard shortcut. */
export function removeUndoAction(stack: UndoAction[], id: string): UndoAction[] {
  return stack.filter((entry) => entry.id !== id);
}
