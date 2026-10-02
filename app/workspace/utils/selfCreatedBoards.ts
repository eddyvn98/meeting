/**
 * Every fresh board id (from "+ New Board", or the bare /workspace auto-
 * redirect) and an id from an external shared link both arrive at
 * useWorkspacePersistence identically — a URL param with no localStorage
 * cache — so a 404 from a board that legitimately hasn't been saved yet
 * would otherwise be indistinguishable from a genuinely broken/denied link.
 * The two id-minting call sites (useWorkspaceBoardId.ts,
 * WorkspaceBoardMenu.tsx's "New Board") mark their id here right before
 * navigating, so useWorkspacePersistence can tell "expected first-save 404"
 * apart from "real load error" without any server-side change.
 */
const STORAGE_KEY = "workspace:self-created-board-ids";
/** Survives closing the tab or browser, unlike the session set above. A board
 *  stays listed here until the server has confirmed it exists, so reopening a
 *  never-saved board still knows its 404 is expected and creates the row. */
const PENDING_KEY = "workspace:pending-create-board-ids";

function readSet(storage: () => Storage, key: string): Set<string> {
  try {
    const raw = storage().getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeSet(storage: () => Storage, key: string, set: Set<string>): void {
  try {
    storage().setItem(key, JSON.stringify([...set]));
  } catch {
    // Best-effort — worst case, a self-created board's first-save 404 gets
    // treated as a load error, which just means the overlay flashes briefly.
  }
}

export function markBoardSelfCreated(id: string): void {
  for (const [storage, key] of [[() => sessionStorage, STORAGE_KEY], [() => localStorage, PENDING_KEY]] as const) {
    const set = readSet(storage, key);
    set.add(id);
    writeSet(storage, key, set);
  }
}

export function wasBoardSelfCreated(id: string): boolean {
  return readSet(() => sessionStorage, STORAGE_KEY).has(id) || readSet(() => localStorage, PENDING_KEY).has(id);
}

/** Called once the server has returned the board: from then on a 404 means it
 *  was deleted, not that it was never saved. */
export function clearBoardPendingCreate(id: string): void {
  const set = readSet(() => localStorage, PENDING_KEY);
  if (set.delete(id)) writeSet(() => localStorage, PENDING_KEY, set);
}
