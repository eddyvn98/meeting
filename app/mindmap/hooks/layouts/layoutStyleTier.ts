import type { MindmapNode, StylePreset } from "@/components/features/chat/mindmap/mindmap-types";
import type { ConnectionPath, PositionedNode } from "./layoutHelpers";
import { DEFAULT_BRANCH_COLORS } from "../../constants/mindmapDefaults";

const BRANCH_COLORS: string[] = [...DEFAULT_BRANCH_COLORS];

export interface LayoutStructureResult {
	nodes: PositionedNode[];
	paths: ConnectionPath[];
	bounds: { minX: number; maxX: number; minY: number; maxY: number };
	nodeToMapRoot: Map<string, MindmapNode>;
	fishboneMapRootIds: ReadonlySet<string>;
}

/**
 * Style tier of the layout pipeline: an O(n) branch-color remap over an already
 * compiled structure. Every surface that renders a compiled structure — the live
 * canvas, quick-add previews, drag projections — must pass through this so a
 * custom style preset never appears to flip colors between frames.
 */
export function applyStylePresetTier<T extends LayoutStructureResult>(
	structure: T,
	stylePreset: StylePreset | null,
): { nodes: PositionedNode[]; paths: ConnectionPath[]; bounds: T["bounds"]; fishboneMapRootIds: ReadonlySet<string> } {
	const { nodes, paths, bounds, nodeToMapRoot, fishboneMapRootIds } = structure;
	// A preset that defines no branch colours has no opinion about them, so
	// applying it repainted every branch from the fallback palette instead of
	// leaving the colours alone — the map visibly changed colour on picking a
	// preset that was never about colour.
	if (!stylePreset?.branchColors?.length) return { nodes, paths, bounds, fishboneMapRootIds };
	const remappedNodes = nodes.map((node) => {
		const mapRoot = nodeToMapRoot.get(node.id);
		const isDrawShape = !!node.node.floating && !node.node.floatingMapRoot;
		const effectivePreset = mapRoot?.style?.stylePreset ?? (isDrawShape ? null : stylePreset);
		const colors = effectivePreset?.branchColors ?? BRANCH_COLORS;
		const idx = BRANCH_COLORS.indexOf(node.branchColor);
		return idx >= 0 ? { ...node, branchColor: colors[idx % colors.length] } : node;
	});
	const remappedPaths = paths.map((path) => {
		// path.id is `${parent.id}-${child.id}`; pick the longest matching prefix
		// so a node whose id happens to prefix another node's id can't be
		// mistaken for the real parent.
		let parentNode: PositionedNode | undefined;
		for (const n of nodes) {
			if (path.id.startsWith(n.id + "-") && (!parentNode || n.id.length > parentNode.id.length)) {
				parentNode = n;
			}
		}

		const mapRoot = parentNode ? nodeToMapRoot.get(parentNode.id) : null;
		const isDrawShape = parentNode ? (!!parentNode.node.floating && !parentNode.node.floatingMapRoot) : false;
		const effectivePreset = mapRoot?.style?.stylePreset ?? (isDrawShape ? null : stylePreset);
		const colors = effectivePreset?.branchColors ?? BRANCH_COLORS;

		const idx = BRANCH_COLORS.indexOf(path.color);
		return idx >= 0 && colors.length
			? { ...path, color: colors[idx % colors.length] }
			: path;
	});
	return { nodes: remappedNodes, paths: remappedPaths, bounds, fishboneMapRootIds };
}
