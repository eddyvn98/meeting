import { MindmapNode, NodeStyle } from "./mindmap-types";
import { estimateFreeFormNodeHeight } from "./mindmap-node-size";

// Node/edge ids are the primary key in the mindmapNode/mindmapRelationship
// tables and are NOT scoped per mindmap there — a collision with another
// mindmap's row fails the whole save transaction (see useMindmapDbSync).
// crypto.randomUUID() makes that collision practically impossible; the old
// 7-char Math.random() scheme did not.
export function generateNodeId(prefix = "n"): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return `${prefix}_${crypto.randomUUID()}`;
	}
	return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

// A brand-new canvas must render as genuinely EMPTY: no starter node, because
// the map's shape is chosen afterwards from the Map Layout panel (which seeds a
// template for the picked layout). So the empty tree is the multi-map
// "virtual-root" container with zero children — the container itself is never
// drawn. `title` is kept only for callers that used to name the starter node;
// the human-facing name lives on the mindmap record, not on this container.
// The literal id is safe to persist: lib/mindmap/repository.ts swaps it for a
// fresh UUID on write and restores the sentinel on read, so two brand-new
// mindmaps can no longer collide on it.
export function createEmptyMindmapTree(_title = "New Mindmap"): MindmapNode {
	return {
		id: "virtual-root",
		// Never "Virtual Root" here: on persist, lib/mindmap/repository.ts swaps
		// the sentinel id for a real UUID, and if this empty document is later
		// merged in as a child map on another canvas (instead of loaded as its
		// own root, the case normalizeVirtualRootId repairs), that swapped node
		// renders as a visible map literally titled "Virtual Root" — colliding
		// with the internal container label everywhere else in this codebase
		// treats as never-a-real-map (see mindmap-chat-action-resolver.ts).
		topic: "New Mindmap",
		children: [],
	};
}

export function getMindmapDisplayTitle(node: MindmapNode | null | undefined): string {
	if (!node) return "Untitled";
	if (node.id === "virtual-root") {
		// Never fall back to the container's own topic ("Virtual Root") — an empty
		// canvas has no map to name yet.
		return node.children?.[0]?.topic || "Untitled";
	}
	return node.topic || "Untitled";
}

// Clone node deeply
export function cloneTree(node: MindmapNode): MindmapNode {
	return {
		...node,
		children: node.children ? node.children.map(cloneTree) : [],
	};
}

// Find node by ID
export function findNodeById(node: MindmapNode, id: string): MindmapNode | null {
	if (node.id === id) return node;
	if (node.children) {
		for (const child of node.children) {
			const found = findNodeById(child, id);
			if (found) return found;
		}
	}
	return null;
}

// Find parent of a node
export function findParentNode(root: MindmapNode, targetId: string): MindmapNode | null {
	if (root.children) {
		for (const child of root.children) {
			if (child.id === targetId) return root;
			const found = findParentNode(child, targetId);
			if (found) return found;
		}
	}
	return null;
}

// Add child to target
export function addChildNode(root: MindmapNode, parentId: string, child: MindmapNode): MindmapNode {
	const clone = cloneTree(root);
	const parent = findNodeById(clone, parentId);
	if (parent) {
		parent.children = parent.children || [];
		parent.children.push(child);
		parent.expanded = true;
	}
	return clone;
}

// Append a node as a free-floating sibling of root, with no parent-child edge to it.
// Mirrors how the "Draw Shape" tool places new shapes at an arbitrary canvas position.
export function appendFloatingNode(root: MindmapNode, node: MindmapNode): MindmapNode {
	if (root.id === "virtual-root") {
		return { ...root, children: [...(root.children || []), node] };
	}
	return { id: "virtual-root", topic: "Virtual Root", children: [root, node] };
}

// Add sibling before target
export function addSiblingNodeBefore(root: MindmapNode, targetId: string, sibling: MindmapNode): MindmapNode {
	const clone = cloneTree(root);
	const parent = findParentNode(clone, targetId);
	if (parent && parent.children) {
		const idx = parent.children.findIndex((c) => c.id === targetId);
		if (idx !== -1) {
			parent.children.splice(idx, 0, sibling);
		}
	}
	return clone;
}

// Add sibling after target
export function addSiblingNode(root: MindmapNode, targetId: string, sibling: MindmapNode): MindmapNode {
	const clone = cloneTree(root);
	const parent = findParentNode(clone, targetId);
	if (parent && parent.children) {
		const idx = parent.children.findIndex((c) => c.id === targetId);
		if (idx !== -1) {
			parent.children.splice(idx + 1, 0, sibling);
		}
	} else if (clone.id === targetId) {
		// If target is root, add as child
		clone.children = clone.children || [];
		clone.children.push(sibling);
		clone.expanded = true;
	}
	return clone;
}

// Update topic text
export function updateNodeText(root: MindmapNode, targetId: string, topic: string): MindmapNode {
	const clone = cloneTree(root);
	const node = findNodeById(clone, targetId);
	if (node) {
		node.topic = topic;
		if (node.style?.freeForm && node.width !== undefined && node.height !== undefined) {
			node.height = estimateFreeFormNodeHeight(
				topic,
				node.description,
				node.width,
				node.height,
				node.style.shape,
				node.style.fontSize ?? 10.5,
				node.style.textPadding ?? 0,
			);
		}
	}
	return clone;
}

// Update node position/size/floating state
export function updateNodeGeometry(
	root: MindmapNode,
	targetId: string,
	updates: { x?: number; y?: number; width?: number; height?: number; floating?: boolean; tableV2?: MindmapNode["tableV2"]; batch?: Array<{ id: string; x: number; y: number; width: number; height: number; rotation?: number; groupTransform?: NodeStyle["groupTransform"] }> }
): MindmapNode {
	const clone = cloneTree(root);
	const items: Array<{ id: string; x?: number; y?: number; width?: number; height?: number; floating?: boolean; tableV2?: MindmapNode["tableV2"]; rotation?: number; groupTransform?: NodeStyle["groupTransform"] }> = updates.batch
		?? [{ id: targetId, ...updates }];
	for (const item of items) {
		const node = findNodeById(clone, item.id);
		if (!node) continue;
		if (item.x !== undefined) node.x = item.x;
		if (item.y !== undefined) node.y = item.y;
		if (item.width !== undefined) node.width = item.width;
		if (item.height !== undefined) node.height = item.height;
		const geometryChanged = item.x !== undefined || item.y !== undefined || item.width !== undefined || item.height !== undefined;
		if (geometryChanged || item.rotation !== undefined || item.groupTransform !== undefined) {
			node.style = { ...node.style, rotation: item.rotation ?? node.style?.rotation, groupTransform: item.groupTransform };
		}
		if (item.floating !== undefined) node.floating = item.floating;
		if (item.tableV2 !== undefined) node.tableV2 = item.tableV2;
	}
	return clone;
}

export {
	removeNode,
	removeNodePromoteChildren,
	indentNode,
	outdentNode,
	moveNodeUpDown,
	insertParentNode,
	moveNodeToParent,
} from "./mindmap-structure-utils";

// Get pre-order flat list of the tree (for outline editor and focus navigation)
export interface FlatNode {
	id: string;
	topic: string;
	depth: number;
	node: MindmapNode;
	parent: MindmapNode | null;
}

export function flattenTree(node: MindmapNode, parent: MindmapNode | null = null, depth = 0, collapsedIds: Set<string> = new Set()): FlatNode[] {
	const result: FlatNode[] = [{ id: node.id, topic: node.topic, depth, node, parent }];
	if (collapsedIds.has(node.id)) return result;
	if (node.children && node.children.length > 0) {
		for (const child of node.children) {
			result.push(...flattenTree(child, node, depth + 1, collapsedIds));
		}
	}
	return result;
}

// Update style for a specific node
export function updateNodeStyle(
	root: MindmapNode,
	targetId: string,
	style: NodeStyle | undefined,
	description?: string,
	icon?: string,
	image?: string
): MindmapNode {
	const clone = cloneTree(root);
	const node = findNodeById(clone, targetId);
	if (node) {
		node.style = style;
		if (description !== undefined) node.description = description;
		if (icon !== undefined) node.icon = icon;
		if (image !== undefined) node.image = image;
	}
	return clone;
}

export function getNodeLevel(root: MindmapNode, targetId: string, currentLevel = 0): number | null {
	if (root.id === targetId) {
		return currentLevel;
	}
	if (root.children && root.children.length > 0) {
		const nextLevel = root.id === "virtual-root" ? currentLevel : currentLevel + 1;
		for (const child of root.children) {
			const lvl = getNodeLevel(child, targetId, nextLevel);
			if (lvl !== null) return lvl;
		}
	}
	return null;
}

export function updateSameLevelNodesStyle(
	root: MindmapNode,
	targetLevel: number,
	style: NodeStyle | undefined,
	currentLevel = 0
): MindmapNode {
	const nextLevel = root.id === "virtual-root" ? currentLevel : currentLevel + 1;

	const updatedChildren = root.children
		? root.children.map((child) => updateSameLevelNodesStyle(child, targetLevel, style, nextLevel))
		: [];

	if (root.id === "virtual-root") {
		return { ...root, children: updatedChildren };
	}

	if (currentLevel === targetLevel) {
		return {
			...root,
			style: style ? { ...style } : undefined,
			children: updatedChildren,
		};
	}

	return {
		...root,
		children: updatedChildren,
	};
}

// Update style for all siblings (same-level) of a node
export function updateSiblingNodesStyle(root: MindmapNode, targetId: string, style: NodeStyle | undefined): MindmapNode {
	const level = getNodeLevel(root, targetId);
	if (level === null) return root;
	return updateSameLevelNodesStyle(root, level, style);
}

export * from "./mindmap-path-utils";
