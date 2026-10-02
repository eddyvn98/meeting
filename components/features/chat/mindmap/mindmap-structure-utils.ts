import type { MindmapNode } from "./mindmap-types";

function cloneTree(node: MindmapNode): MindmapNode {
	return { ...node, children: node.children ? node.children.map(cloneTree) : [] };
}

function findNodeById(node: MindmapNode, id: string): MindmapNode | null {
	if (node.id === id) return node;
	for (const child of node.children || []) {
		const found = findNodeById(child, id);
		if (found) return found;
	}
	return null;
}

function findParentNode(root: MindmapNode, targetId: string): MindmapNode | null {
	for (const child of root.children || []) {
		if (child.id === targetId) return root;
		const found = findParentNode(child, targetId);
		if (found) return found;
	}
	return null;
}

export function removeNode(root: MindmapNode, targetId: string): MindmapNode {
	if (root.id === targetId) return { ...root, children: [] };
	const clone = cloneTree(root);
	const parent = findParentNode(clone, targetId);
	if (parent?.children) parent.children = parent.children.filter((child) => child.id !== targetId);
	return clone;
}

export function removeNodePromoteChildren(root: MindmapNode, targetId: string): MindmapNode {
	if (root.id === targetId) return root;
	const clone = cloneTree(root);
	const parent = findParentNode(clone, targetId);
	if (!parent?.children) return clone;
	const index = parent.children.findIndex((child) => child.id === targetId);
	if (index !== -1) parent.children.splice(index, 1, ...(parent.children[index].children || []));
	return clone;
}

export function indentNode(root: MindmapNode, targetId: string): MindmapNode {
	if (root.id === targetId) return root;
	const clone = cloneTree(root);
	const parent = findParentNode(clone, targetId);
	const index = parent?.children?.findIndex((child) => child.id === targetId) ?? -1;
	if (parent?.children && index > 0) {
		const [target] = parent.children.splice(index, 1);
		parent.children[index - 1].children = [...(parent.children[index - 1].children || []), target];
		parent.children[index - 1].expanded = true;
	}
	return clone;
}

export function outdentNode(root: MindmapNode, targetId: string): MindmapNode {
	if (root.id === targetId) return root;
	const clone = cloneTree(root);
	const parent = findParentNode(clone, targetId);
	const grandParent = parent && findParentNode(clone, parent.id);
	const target = findNodeById(clone, targetId);
	if (parent?.children && grandParent?.children && target) {
		parent.children = parent.children.filter((child) => child.id !== targetId);
		const index = grandParent.children.findIndex((child) => child.id === parent.id);
		if (index !== -1) grandParent.children.splice(index + 1, 0, target);
	}
	return clone;
}

export function moveNodeUpDown(root: MindmapNode, targetId: string, direction: "up" | "down"): MindmapNode {
	if (root.id === targetId) return root;
	const clone = cloneTree(root);
	const siblings = findParentNode(clone, targetId)?.children;
	const index = siblings?.findIndex((child) => child.id === targetId) ?? -1;
	const next = direction === "up" ? index - 1 : index + 1;
	if (siblings && index !== -1 && next >= 0 && next < siblings.length) [siblings[index], siblings[next]] = [siblings[next], siblings[index]];
	return clone;
}

/** Detach `targetId` from its current parent and insert it as a child of
 * `newParentId` at `newIndex` (used by the outline panel's drag-and-drop).
 * Returns the original `root` reference unchanged (not a clone) for any
 * no-op/invalid move — self-drop, dropping onto its own descendant (would
 * create a cycle), or either id not found — so callers can skip pushing a
 * no-op update by comparing the result against the input via `===`. */
export function moveNodeToParent(root: MindmapNode, targetId: string, newParentId: string, newIndex: number): MindmapNode {
	if (targetId === newParentId || root.id === targetId) return root;
	const target = findNodeById(root, targetId);
	const newParent = findNodeById(root, newParentId);
	if (!target || !newParent) return root;

	let cursor: MindmapNode | null = newParent;
	while (cursor) {
		if (cursor.id === targetId) return root; // would create a cycle
		cursor = findParentNode(root, cursor.id);
	}

	const clone = cloneTree(root);
	const clonedTarget = findNodeById(clone, targetId)!;
	const oldParent = findParentNode(clone, targetId);
	if (oldParent?.children) {
		oldParent.children = oldParent.children.filter((child) => child.id !== targetId);
	}
	const clonedNewParent = findNodeById(clone, newParentId)!;
	clonedNewParent.children = clonedNewParent.children || [];
	const clampedIndex = Math.max(0, Math.min(newIndex, clonedNewParent.children.length));
	clonedNewParent.children.splice(clampedIndex, 0, clonedTarget);
	clonedNewParent.expanded = true;
	return clone;
}

export function insertParentNode(root: MindmapNode, targetId: string, newParent: MindmapNode): MindmapNode {
	if (root.id === targetId) return { ...newParent, children: [cloneTree(root)] };
	const clone = cloneTree(root);
	const parent = findParentNode(clone, targetId);
	const index = parent?.children?.findIndex((child) => child.id === targetId) ?? -1;
	if (parent?.children && index !== -1) {
		newParent.children = [parent.children[index]];
		parent.children[index] = newParent;
	}
	return clone;
}
