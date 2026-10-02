/**
 * lib/meeting/minutesReorder.ts
 *
 * Pure array-reorder helpers for the MOM matters/rows editor (Stage B) —
 * moving a matter or a row up/down within its list. Generic over the
 * element type so the same function backs both "move matter" and "move
 * row" without duplicating the swap logic.
 */

/** Swaps the element at `index` with its up/down neighbor and returns a
 *  new array (input is never mutated). Returns the SAME array reference
 *  when the move is a no-op (index out of range, or already at the edge in
 *  that direction) so callers can cheaply skip a state update / API call
 *  by reference-comparing the result. */
export function moveItem<T>(items: T[], index: number, direction: "up" | "down"): T[] {
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= items.length || swapWith < 0 || swapWith >= items.length) {
    return items;
  }
  const next = items.slice();
  [next[index], next[swapWith]] = [next[swapWith], next[index]];
  return next;
}

/** Removes the element at `index`, returning a new array. Out-of-range
 *  indices are a no-op (same array reference back). */
export function removeItem<T>(items: T[], index: number): T[] {
  if (index < 0 || index >= items.length) return items;
  return items.slice(0, index).concat(items.slice(index + 1));
}
