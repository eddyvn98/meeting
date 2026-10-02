/**
 * Thin fetch wrappers around /api/workspaces/[id]/comments — same fail-soft
 * convention as workspaceBoardApi.ts/workspaceShareApi.ts.
 */

export interface WorkspaceComment {
  id: string;
  boardId: string;
  blockId: string;
  authorEmail: string;
  body: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
  /** Null for a top-level comment; set for a reply (one level deep only). */
  parentId: string | null;
}

export async function fetchBoardComments(boardId: string): Promise<WorkspaceComment[]> {
  try {
    const res = await fetch(`/api/workspaces/${boardId}/comments`);
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as WorkspaceComment[]) : [];
  } catch {
    return [];
  }
}

export async function addBoardComment(
  boardId: string,
  blockId: string,
  body: string,
  parentId?: string | null,
): Promise<WorkspaceComment | null> {
  const retryDelays = [0, 250, 500, 1_000, 1_500];
  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    if (retryDelays[attempt] > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
    }
    try {
      const res = await fetch(`/api/workspaces/${boardId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockId, body, parentId: parentId ?? undefined }),
      });
      if (res.status === 404 && attempt < retryDelays.length - 1) continue;
      if (!res.ok) return null;
      return (await res.json()) as WorkspaceComment;
    } catch {
      return null;
    }
  }
  return null;
}

export async function setCommentResolved(
  boardId: string,
  commentId: string,
  resolved: boolean,
): Promise<void> {
  try {
    await fetch(`/api/workspaces/${boardId}/comments/${commentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved }),
    });
  } catch {
    // Best-effort
  }
}

export async function updateBoardComment(
  boardId: string,
  commentId: string,
  body: string,
): Promise<WorkspaceComment | null> {
  try {
    const res = await fetch(`/api/workspaces/${boardId}/comments/${commentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) return null;
    return (await res.json()) as WorkspaceComment;
  } catch {
    return null;
  }
}

export async function deleteBoardComment(boardId: string, commentId: string): Promise<void> {
  try {
    await fetch(`/api/workspaces/${boardId}/comments/${commentId}`, { method: "DELETE" });
  } catch {
    // Best-effort
  }
}
