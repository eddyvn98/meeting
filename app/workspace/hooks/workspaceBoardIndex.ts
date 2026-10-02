/**
 * Local board index (list of every board this browser knows about) +
 * cross-tab board CRUD helpers — split out of useWorkspacePersistence.ts to
 * keep that file under the project's 300-line cap. The board's own
 * blocks/blockOrder/connectors/camera snapshot lives under a separate
 * per-board key (boardKey(id)); this file only manages the index row
 * (id/title/updatedAt) and the few operations (delete/rename) that touch
 * both the index and the per-board snapshot together.
 */
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { deleteRemoteBoard, renameRemoteBoard } from "./workspaceBoardApi";
import { clearBoardPendingCreate, wasBoardSelfCreated } from "../utils/selfCreatedBoards";
import { createWorkspaceId } from "../utils/workspaceId";

export const LEGACY_DRAFT_KEY = "workspace-engine-v1-draft";
export const INDEX_KEY = "workspace-engine-v2-index";
export const LAST_OPENED_BOARD_KEY = "workspace-engine-v2-last-opened";
export const boardKey = (id: string) => `workspace-engine-v2-board-${id}`;

export interface BoardIndexEntry {
  id: string;
  title: string;
  updatedAt: number;
  /** When the board was first created. The board menu orders by this so a
   *  board never moves in the list once the reader has learned where it is
   *  (see sortWorkspaceBoardsByCreation). Optional because rows written
   *  before this field existed have no stamp — those fall back to
   *  updatedAt, exactly as legacy's sortMindmapsByCreation does. */
  createdAt?: number;
  /** Set only from the server's list (GET /api/workspaces) — whether this
   *  board is shared with someone or exposed by a live public link. Never
   *  written to localStorage's index, so it is undefined until that fetch
   *  lands and after a page reload until it lands again. */
  hasCollaborators?: boolean;
  hasPublicShareLink?: boolean;
}

export interface BoardSnapshot {
  blocks?: unknown;
  blockOrder?: unknown;
  connectors?: unknown;
  camera?: unknown;
  /** Saved camera bookmarks (CameraFrame[]) — see migration
   *  20260908140000_add_workspace_board_frames. */
  frames?: unknown;
  title?: unknown;
  /** Also persisted server-side (columns on WorkspaceBoard) since
   *  migration 20260903090000 — a board opened without this local cache
   *  keeps its layout instead of resetting to the defaults. */
  treeLayoutDirection?: unknown;
  treeGrowthMode?: unknown;
  treeLayoutFamily?: unknown;
  treeTimelineBranchMode?: unknown;
  treeTimelineDescendantStyle?: unknown;
  treeCatalogDescendantStyle?: unknown;
  savedAt?: number;
}

export function readIndex(): BoardIndexEntry[] {
  try {
    const raw = window.localStorage.getItem(INDEX_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as BoardIndexEntry[]) : [];
  } catch {
    return [];
  }
}

export function writeIndex(entries: BoardIndexEntry[]): void {
  try {
    window.localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
  } catch {
    // Ignore storage errors (e.g. private browsing quota)
  }
}

/** Moves (or inserts) `entry` to the front of the index, replacing any
 *  existing row for the same board id. An existing row's `createdAt` wins:
 *  a save must never restamp the board as newly created, or ordering by
 *  creation would drift back to ordering by last edit. */
export function upsertIndexEntry(entry: BoardIndexEntry): void {
  const index = readIndex();
  const existing = index.find((row) => row.id === entry.id);
  const rest = index.filter((row) => row.id !== entry.id);
  const createdAt = existing?.createdAt ?? entry.createdAt ?? entry.updatedAt;
  writeIndex([{ ...entry, createdAt }, ...rest]);
}

export function createWorkspaceBoardEntry(id: string, title = "New Mindmap"): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  upsertIndexEntry({ id, title, updatedAt: now, createdAt: now });
}

/** One-time upgrade from the pre-multi-board single fixed key: adopts it as
 *  the first board in the new index, then removes the old key so it doesn't
 *  get migrated again on a later visit. No-op once the index has any entry. */
export function migrateLegacyDraft(): void {
  if (readIndex().length > 0) return;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(LEGACY_DRAFT_KEY);
  } catch {
    return;
  }
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw) as BoardSnapshot;
    const id = createWorkspaceId();
    const title = typeof parsed.title === "string" && parsed.title !== "Untitled Workspace"
      ? parsed.title
      : "New Mindmap";
    window.localStorage.setItem(boardKey(id), raw);
    upsertIndexEntry({ id, title, updatedAt: parsed.savedAt ?? Date.now() });
  } catch {
    // Corrupt legacy draft — nothing worth carrying forward.
  } finally {
    window.localStorage.removeItem(LEGACY_DRAFT_KEY);
  }
}

export function listWorkspaceBoards(): BoardIndexEntry[] {
  if (typeof window === "undefined") return [];
  return readIndex();
}

/** Remember the board that should open when the user enters Workspace from
 * the home launcher without an explicit `?id=`. */
export function rememberLastOpenedWorkspaceBoard(id: string): void {
  if (typeof window === "undefined" || !id) return;
  try {
    window.localStorage.setItem(LAST_OPENED_BOARD_KEY, id);
  } catch {
    // Ignore storage errors
  }
}

export function readLastOpenedWorkspaceBoard(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_OPENED_BOARD_KEY);
  } catch {
    return null;
  }
}

export async function deleteWorkspaceBoard(id: string): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === "undefined") return { ok: false, error: "Workspace is unavailable" };

  // Complete the server mutation before changing the local index. Otherwise
  // the caller's immediate refresh can race the DELETE and merge the stale
  // server row back into the sidebar.
  const remoteResult = await deleteRemoteBoard(id);
  if (!remoteResult.ok && remoteResult.status !== 404) return remoteResult;

  clearBoardPendingCreate(id);
  writeIndex(readIndex().filter((row) => row.id !== id));
  try {
    window.localStorage.removeItem(boardKey(id));
  } catch {
    // Ignore storage errors
  }
  return { ok: true };
}

export async function renameWorkspaceBoard(id: string, title: string): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === "undefined") return { ok: false, error: "Workspace is unavailable" };
  const entries = readIndex();
  const target = entries.find((e) => e.id === id);
  const previousTitle = target?.title;
  const applyLocalTitle = (next: string) => {
    const updatedAt = Date.now();
    if (target) {
      writeIndex(readIndex().map((e) => (e.id === id ? { ...e, title: next, updatedAt } : e)));
    } else {
      upsertIndexEntry({ id, title: next, updatedAt });
    }
    try {
      const raw = window.localStorage.getItem(boardKey(id));
      if (raw) {
        const snapshot = JSON.parse(raw) as BoardSnapshot;
        snapshot.title = next;
        snapshot.savedAt = updatedAt;
        window.localStorage.setItem(boardKey(id), JSON.stringify(snapshot));
      }
    } catch {
      // Ignore storage errors
    }
  };
  applyLocalTitle(title);

  // The open board persists through its own autosave (or the live room), so
  // changing the store title is the whole job.
  if (useWorkspaceStore.getState().boardId === id) {
    useWorkspaceStore.getState().setTitle(title);
    return { ok: true };
  }

  const result = await renameRemoteBoard(id, title);
  // A board that has never reached the server picks the new title up from its
  // local snapshot when it is first created.
  if (result.ok || (result.status === 404 && wasBoardSelfCreated(id))) return { ok: true };
  if (previousTitle !== undefined) applyLocalTitle(previousTitle);
  return { ok: false, error: result.error ?? "Failed to rename workspace" };
}
