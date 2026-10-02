import { MindmapNode, PositionedNode } from "./mindmap-types";
import { findParentNode, findNodeById } from "./mindmap-utils";

/**
 * Given a Mindmap tree and a set of selected node IDs, returns the Set of node IDs
 * that belong to the active "node chain" (ancestors + selected nodes + descendants).
 * Returns null if selectedNodeIds is empty (meaning no node is selected).
 */
export function getNodeChainIds(
	tree: MindmapNode | null | undefined,
	selectedNodeIds: Set<string> | string[] | null | undefined
): Set<string> | null {
	const ids = Array.isArray(selectedNodeIds)
		? new Set(selectedNodeIds)
		: selectedNodeIds;

	if (!tree || !ids || ids.size === 0) return null;

	const chain = new Set<string>();

	for (const selectedId of ids) {
		if (!selectedId) continue;
		chain.add(selectedId);

		// 1. Ancestors: trace parent nodes up to root
		let currId: string | null = selectedId;
		while (currId) {
			const parent = findParentNode(tree, currId);
			if (parent && parent.id && parent.id !== "virtual-root") {
				chain.add(parent.id);
				currId = parent.id;
			} else {
				if (tree.id && tree.id !== "virtual-root") {
					chain.add(tree.id);
				}
				break;
			}
		}

		// 2. Descendants: recursively add all children
		const selectedNode = findNodeById(tree, selectedId);
		if (selectedNode) {
			const addDescendants = (n: MindmapNode) => {
				if (n.children) {
					for (const child of n.children) {
						chain.add(child.id);
						addDescendants(child);
					}
				}
			};
			addDescendants(selectedNode);
		}
	}

	return chain.size > 0 ? chain : null;
}

export function parsePathId(
	pathId: string,
	nodes: PositionedNode[],
	nodeIds: Set<string>
): { parentId?: string; childId?: string } | null {
	const parts = pathId.replace(/^path-/, "").split("-");
	if (parts.length >= 2) {
		const parentId = parts[0];
		const childId = parts.slice(1).join("-");
		if (nodeIds.has(parentId) && nodeIds.has(childId)) {
			return { parentId, childId };
		}
	}
	for (const parent of nodes) {
		if (pathId.includes(parent.id)) {
			for (const child of nodes) {
				if (parent.id !== child.id && pathId.includes(child.id)) {
					return { parentId: parent.id, childId: child.id };
				}
			}
		}
	}
	return null;
}
