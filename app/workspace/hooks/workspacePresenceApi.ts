/**
 * Thin fetch wrappers around /api/workspaces/[id]/presence — fail-soft
 * convention for presence heartbeat and viewer polling.
 */

export interface WorkspaceViewer {
  email: string;
  lastSeenAt: string;
  selectedBlockId?: string | null;
  editingBlockId?: string | null;
}

export interface PresenceResult {
  ok: boolean;
  error?: string;
}

export async function fetchActiveViewers(boardId: string): Promise<WorkspaceViewer[]> {
  try {
    const res = await fetch(`/api/workspaces/${boardId}/presence`);
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as WorkspaceViewer[]) : [];
  } catch {
    return [];
  }
}

export async function sendPresenceHeartbeat(
  boardId: string,
  selectedBlockId?: string | null,
  editingBlockId?: string | null,
): Promise<PresenceResult> {
  try {
    const res = await fetch(`/api/workspaces/${boardId}/presence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selectedBlockId: selectedBlockId ?? null,
        editingBlockId: editingBlockId ?? null,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `Heartbeat failed with status ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error sending presence heartbeat",
    };
  }
}
