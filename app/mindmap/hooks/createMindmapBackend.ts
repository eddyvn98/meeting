import { MindmapNode, NodeShapeType, StylePreset } from "@/components/features/chat/mindmap/mindmap-types";
import { LayoutType } from "@/app/mindmap/hooks/usePageLayout";

export interface CreateMindmapBackendInput {
	title: string;
	tree: MindmapNode;
	layoutType?: LayoutType;
	connectionStyle?: "curved" | "orthogonal" | "straight";
	stylePreset?: StylePreset | null;
	nodeShape?: NodeShapeType;
	freeLayout?: boolean;
}

export interface CreatedMindmapBackendRecord {
	id: string;
	title?: string;
	tree?: MindmapNode;
	updatedAt?: string | number;
	layoutType?: LayoutType;
	connectionStyle?: "curved" | "orthogonal" | "straight";
	stylePreset?: StylePreset | null;
	nodeShape?: NodeShapeType;
	freeLayout?: boolean;
}

export async function createMindmapInBackend(
	input: CreateMindmapBackendInput,
): Promise<CreatedMindmapBackendRecord> {
	const response = await fetch("/api/mindmaps", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
	const payload = await response.json().catch(() => null) as CreatedMindmapBackendRecord | { error?: string } | null;
	const record = payload && typeof payload === "object" && typeof (payload as { id?: unknown }).id === "string"
		? payload as CreatedMindmapBackendRecord
		: null;
	if (!response.ok || !record) {
		const message = payload && typeof (payload as { error?: unknown }).error === "string"
			? (payload as { error: string }).error
			: "Không thể lưu mindmap vào máy chủ";
		throw new Error(message);
	}
	return record;
}
