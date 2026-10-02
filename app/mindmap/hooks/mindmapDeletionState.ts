const DELETED_MINDMAPS_KEY = "mindmaps_deleted_tombstones";
const TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MINDMAP_DELETED_EVENT = "mindmap:deleted";

type Tombstones = Record<string, number>;
const mindmapDeletionControllers = new Map<string, AbortController>();

function isMindmapCacheKey(key: string, id: string): boolean {
	return key === `mindmap_${id}` || (key.startsWith("mindmap_") && key.endsWith(`_${id}`));
}

function readTombstones(): Tombstones {
	if (typeof window === "undefined") return {};
	try {
		const raw = JSON.parse(localStorage.getItem(DELETED_MINDMAPS_KEY) || "{}");
		if (!raw || typeof raw !== "object") return {};
		const now = Date.now();
		return Object.fromEntries(
			Object.entries(raw as Tombstones).filter(([, deletedAt]) =>
				typeof deletedAt === "number" && now - deletedAt < TOMBSTONE_TTL_MS,
			),
		);
	} catch {
		return {};
	}
}

export function isMindmapDeleted(id: string): boolean {
	return Boolean(id && readTombstones()[id]);
}

export function markMindmapDeleted(id: string): void {
	if (typeof window === "undefined" || !id) return;
	mindmapDeletionControllers.get(id)?.abort();
	mindmapDeletionControllers.set(id, new AbortController());
	const tombstones = readTombstones();
	tombstones[id] = Date.now();
	localStorage.setItem(DELETED_MINDMAPS_KEY, JSON.stringify(tombstones));
}

export function clearMindmapDeleted(id: string): void {
	if (typeof window === "undefined" || !id) return;
	mindmapDeletionControllers.get(id)?.abort();
	mindmapDeletionControllers.delete(id);
	const tombstones = readTombstones();
	if (!(id in tombstones)) return;
	delete tombstones[id];
	localStorage.setItem(DELETED_MINDMAPS_KEY, JSON.stringify(tombstones));
}

export function getMindmapDeletionSignal(id: string): AbortSignal | undefined {
	return mindmapDeletionControllers.get(id)?.signal;
}

/** Remove the record and every per-map browser cache keyed by this id. */
export function clearMindmapLocalCache(id: string): void {
	if (typeof window === "undefined" || !id) return;
	try {
		const keysToRemove: string[] = [];
		for (let index = 0; index < localStorage.length; index += 1) {
			const key = localStorage.key(index);
			if (key && isMindmapCacheKey(key, id)) keysToRemove.push(key);
		}
		keysToRemove.forEach((key) => localStorage.removeItem(key));
	} catch {
		// A restricted storage implementation must not break map deletion.
	}
}

export function purgeTombstonedMindmapCaches(): void {
	if (typeof window === "undefined") return;
	Object.keys(readTombstones()).forEach(clearMindmapLocalCache);
}

export async function removePersistedMindmap(id: string): Promise<void> {
	if (!id || id.startsWith("mm_")) return;
	try {
		await fetch(`/api/mindmaps?id=${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true });
	} catch {
		// The tombstone still prevents local resurrection; a later user action can retry.
	}
}
