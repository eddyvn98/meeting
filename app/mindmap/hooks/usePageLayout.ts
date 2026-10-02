"use client";
import { useMemo, useRef } from "react";
import { MindmapNode, StylePreset, NodeShapeType } from "@/components/features/chat/mindmap/mindmap-types";
import { PositionedNode, ConnectionPath, calcSubtreeHeights, calcSubtreeWidths, setDefaultShape } from "./layouts/layoutHelpers";
import { runLayoutRight, runLayoutLeft, runLayoutMindmap } from "./layouts/layoutRight";
import { runLayoutOrg, runLayoutCatalog, runLayoutMindmapVertical } from "./layouts/layoutOrgChart";
import { runLayoutCatalogHierarchy } from "./layouts/layoutCatalogHierarchy";
import { runLayoutTimeline, runLayoutFishbone } from "./layouts/layoutTimeline";
import { routeLayoutPaths } from "./layouts/layoutPathRouter";
import { isFreeFormMap, runLayoutFreeForm } from "./layouts/layoutFreeForm";
import { applyMapLayoutRotations } from "./layouts/layoutRotation";
import { resolveLayoutGeometry } from "./layouts/layoutGeometry";
import { resolveMapLayout } from "./layouts/mapLayoutConfig";
import { applyCanonicalLayoutMirrors, normalizeCanonicalCustomPosition } from "./layouts/layoutMirror";
import { avoidLineNodeOverlaps } from "./layouts/lineNodeAvoidance";
import { avoidFloatingNodeOverlaps } from "./layouts/layoutCollision";
import { applyStylePresetTier } from "./layouts/layoutStyleTier";
import { translatePath, runLayoutFlowchart, runLayoutSwimlane } from "./layouts/layoutFlowchartAdapters";
import { resolveCollapseDirections } from "./layouts/collapseDirection";
import { DEFAULT_BRANCH_COLORS, resolveDefaultNodeShape } from "../constants/mindmapDefaults";
export type LayoutType = "logical-right" | "logical-left" | "mindmap" | "mindmap-vertical" | "org-chart" | "catalog" | "timeline" | "vertical-timeline" | "fishbone" | "flowchart" | "swimlane";

const BRANCH_COLORS: string[] = [...DEFAULT_BRANCH_COLORS];

export function compilePageLayoutStructure(
	tree: MindmapNode,
	layoutType: LayoutType,
	connectionStyle: "curved" | "orthogonal" | "straight" = "curved",
	freeLayout = false,
	defaultNodeShape: NodeShapeType = "rounded",
	routeCache: Map<string, string> = new Map()
) {
		setDefaultShape(defaultNodeShape);
		const positioned: PositionedNode[] = [];
		const connections: ConnectionPath[] = [];
		const activeColors = BRANCH_COLORS;
		const nodeToMapRoot = new Map<string, MindmapNode>();
		const fishboneMapRootIds = new Set<string>();
		const assignMapRoot = (node: MindmapNode, mapRoot: MindmapNode) => {
			nodeToMapRoot.set(node.id, mapRoot);
			node.children?.forEach((child) => assignMapRoot(child, mapRoot));
		};
		if (!tree) return { nodes: [], paths: [], bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 }, nodeToMapRoot, fishboneMapRootIds };
		// A stray empty virtual-root sentinel can end up nested as one of the
		// container's own children (e.g. an empty canvas merged in as a map
		// instead of being replaced). It carries no content of its own — drawing
		// it as a real map box is confusing and it can't be deleted like a normal
		// node. Keep it out of layout/render entirely; it stays in the data tree
		// for whatever produced it to clean up.
		const mapChildren = tree.id === "virtual-root"
			? (tree.children || []).filter((child) => child.id !== "virtual-root")
			: [];
		if (tree.id === "virtual-root") {
			mapChildren.forEach((child) => assignMapRoot(child, child));
		} else {
			assignMapRoot(tree, tree);
		}

		const subtreeHeights: Record<string, number> = {};
		calcSubtreeHeights(tree, subtreeHeights);
		const subtreeWidths: Record<string, number> = {};
		calcSubtreeWidths(tree, subtreeWidths);
		const positionedById = new Map<string, PositionedNode>();

		if (tree.id === "virtual-root") {
			let currentY = 40;
			(tree.children || []).forEach((child, idx) => {
				const childHeight = subtreeHeights[child.id] || 150;
				const cc = child.style?.color ?? activeColors[idx % activeColors.length];
				const storedLayoutType = child.style?.layoutType ?? layoutType;
				const resolvedChildLayout = resolveMapLayout(storedLayoutType, child.style);
				const childLayoutType = resolvedChildLayout.engineLayoutType;
				const childPreset = child.style?.stylePreset ?? null;
				const childConnectionStyle = child.style?.connectionStyle ?? connectionStyle;
				const currentActiveColors = childPreset ? childPreset.branchColors : activeColors;

				if (isFreeFormMap(child)) {
					runLayoutFreeForm(child, currentActiveColors, positioned, connections, currentY, positionedById);
				} else if (childLayoutType === "logical-right") {
					runLayoutRight(child, 0, 40, currentY, cc, currentActiveColors, subtreeHeights, positioned, connections, positionedById, childConnectionStyle);
				} else if (childLayoutType === "logical-left") {
					runLayoutLeft(child, currentActiveColors, subtreeHeights, positioned, connections, positionedById, childConnectionStyle, currentY);
				} else if (childLayoutType === "mindmap") {
					runLayoutMindmap(child, currentActiveColors, subtreeHeights, positioned, connections, positionedById, childConnectionStyle, currentY);
				} else if (childLayoutType === "mindmap-vertical") {
					runLayoutMindmapVertical(child, currentActiveColors, subtreeWidths, positioned, connections, positionedById, childConnectionStyle, currentY);
				} else if (childLayoutType === "org-chart") {
					const totalW = subtreeWidths[child.id] || 200;
					runLayoutOrg(child, 0, 40 + totalW / 2, cc, currentActiveColors, subtreeWidths, positioned, connections, positionedById, currentY);
				} else if (childLayoutType === "catalog") {
					const catalogYRef = { value: currentY };
					if (child.style?.catalogDescendantStyle === "hierarchy") {
						runLayoutCatalogHierarchy(child, cc, currentActiveColors, positioned, connections, catalogYRef, positionedById);
					} else {
						runLayoutCatalog(child, 0, cc, currentActiveColors, positioned, connections, catalogYRef, positionedById);
					}
				} else if (resolvedChildLayout.family === "timeline") {
					runLayoutTimeline(child, childLayoutType === "timeline" ? "horizontal" : "vertical", currentActiveColors, positioned, connections, currentY, child.style?.timelineBranchMode, childConnectionStyle, child.style?.timelineDescendantStyle);
				} else if (childLayoutType === "fishbone") {
					runLayoutFishbone(child, currentActiveColors, positioned, connections, child.floating && child.y !== undefined ? child.y - 260 : currentY, "nested", positionedById, child.floating ? child.x : undefined);
				} else if (childLayoutType === "flowchart") {
					runLayoutFlowchart(child, currentActiveColors, positioned, connections, currentY);
				} else if (childLayoutType === "swimlane") {
					runLayoutSwimlane(child, currentActiveColors, positioned, connections, currentY);
				}
				currentY += childHeight + 150;
			});
		} else {
			const storedLayoutType = tree.style?.layoutType ?? layoutType;
			const resolvedChildLayout = resolveMapLayout(storedLayoutType, tree.style);
			const childLayoutType = resolvedChildLayout.engineLayoutType;
			const childPreset = tree.style?.stylePreset ?? null;
			const childConnectionStyle = tree.style?.connectionStyle ?? connectionStyle;
			const currentActiveColors = childPreset ? childPreset.branchColors : activeColors;

			if (isFreeFormMap(tree)) {
				runLayoutFreeForm(tree, currentActiveColors, positioned, connections, 40, positionedById);
			} else if (childLayoutType === "logical-right") {
				runLayoutRight(tree, 0, 40, 40, currentActiveColors[0], currentActiveColors, subtreeHeights, positioned, connections, positionedById, childConnectionStyle);
			} else if (childLayoutType === "logical-left") {
				runLayoutLeft(tree, currentActiveColors, subtreeHeights, positioned, connections, positionedById, childConnectionStyle);
			} else if (childLayoutType === "mindmap") {
				runLayoutMindmap(tree, currentActiveColors, subtreeHeights, positioned, connections, positionedById, childConnectionStyle);
			} else if (childLayoutType === "mindmap-vertical") {
				runLayoutMindmapVertical(tree, currentActiveColors, subtreeWidths, positioned, connections, positionedById, childConnectionStyle);
			} else if (childLayoutType === "org-chart") {
				const totalW = subtreeWidths[tree.id];
				runLayoutOrg(tree, 0, 40 + totalW / 2, currentActiveColors[0], currentActiveColors, subtreeWidths, positioned, connections, positionedById);
			} else if (childLayoutType === "catalog") {
				const catalogYRef = { value: 40 };
				if (tree.style?.catalogDescendantStyle === "hierarchy") {
					runLayoutCatalogHierarchy(tree, currentActiveColors[0], currentActiveColors, positioned, connections, catalogYRef, positionedById);
				} else {
					runLayoutCatalog(tree, 0, currentActiveColors[0], currentActiveColors, positioned, connections, catalogYRef, positionedById);
				}
			} else if (resolvedChildLayout.family === "timeline") {
				runLayoutTimeline(tree, childLayoutType === "timeline" ? "horizontal" : "vertical", currentActiveColors, positioned, connections, 40, tree.style?.timelineBranchMode, childConnectionStyle, tree.style?.timelineDescendantStyle);
			} else if (childLayoutType === "fishbone") {
				runLayoutFishbone(tree, currentActiveColors, positioned, connections, 40, "nested", positionedById);
			} else if (childLayoutType === "flowchart") {
				runLayoutFlowchart(tree, currentActiveColors, positioned, connections);
			} else if (childLayoutType === "swimlane") {
				runLayoutSwimlane(tree, currentActiveColors, positioned, connections);
			}
		}

		positioned.forEach((node) => positionedById.set(node.id, node));
		connections.forEach((path) => {
			if (path.id.endsWith("-spine-backbone")) {
				fishboneMapRootIds.add(path.id.slice(0, -"-spine-backbone".length));
			}
		});

		const collectSubtreeIds = (node: MindmapNode, out: Set<string>) => {
			out.add(node.id);
			node.children?.forEach((child) => collectSubtreeIds(child, out));
		};

		const autoPositions = new Map(positioned.map((node) => [node.id, { x: node.x, y: node.y }]));
		if (tree.id === "virtual-root") {
			for (const mapRoot of tree.children || []) {
				if (mapRoot.x === undefined || mapRoot.y === undefined) continue;
				const rootPosition = autoPositions.get(mapRoot.id);
				if (!rootPosition) continue;
				const dx = mapRoot.x - rootPosition.x;
				const dy = mapRoot.y - rootPosition.y;
				const subtreeIds = new Set<string>();
				collectSubtreeIds(mapRoot, subtreeIds);
				for (const path of connections) {
					if (Array.from(subtreeIds).some((id) => path.id.startsWith(`${id}-`))) {
						path.d = translatePath(path.d, dx, dy);
					}
				}
				for (const id of subtreeIds) {
					const position = autoPositions.get(id);
					if (position) autoPositions.set(id, { x: position.x + dx, y: position.y + dy });
				}
			}
		}

		{
			const applyCustomPositions = (
				node: MindmapNode,
				positionedMap: Map<string, PositionedNode>,
				shiftX = 0, shiftY = 0,
				lockDescendantsToLayout = false,
				isMapRoot = false
			) => {
				const posNode = positionedMap.get(node.id);
				if (!posNode) return;
				let currentShiftX = shiftX;
				let currentShiftY = shiftY;
				const mapRoot = nodeToMapRoot.get(node.id);
				const keepsFishboneLayout = node.id !== mapRoot?.id && (
					fishboneMapRootIds.has(mapRoot?.id ?? "")
					|| resolveMapLayout(mapRoot?.style?.layoutType ?? layoutType, mapRoot?.style).engineLayoutType === "fishbone"
				);
				// A normal flowchart map preserves manually dragged child positions.
				// Floating maps and maps with an explicit orientation are rebuilt from
				// the flowchart engine, so descendant x/y values there are stale or
				// belong to the pre-rotation coordinate system.
				const flowchartRoot = (mapRoot?.style?.layoutType ?? layoutType) === "flowchart";
				const hasExplicitFlowchartAngle = Object.prototype.hasOwnProperty.call(mapRoot?.style ?? {}, "layoutAngle");
				const keepsFlowchartPosition = !isMapRoot
					&& flowchartRoot
					&& !mapRoot?.floating
					&& !hasExplicitFlowchartAngle
					&& node.x !== undefined
					&& node.y !== undefined;
				// isMapRoot: stored x/y anchors whole-map position across layout-type switches
				if ((!keepsFishboneLayout && (node.floating || keepsFlowchartPosition))
					|| (!lockDescendantsToLayout && isMapRoot && node.x !== undefined && node.y !== undefined)) {
					const originalX = posNode.x;
					const originalY = posNode.y;
					let nextX = node.x ?? originalX;
					let nextY = node.y ?? originalY;
					const mapRootPosition = mapRoot ? positionedMap.get(mapRoot.id) : undefined;
					if (mapRoot && mapRootPosition && node.id !== mapRoot.id) {
						const normalized = normalizeCanonicalCustomPosition(
							{ x: nextX, y: nextY, width: posNode.width },
							mapRoot,
							{ x: mapRootPosition.x + mapRootPosition.width / 2, y: mapRootPosition.y },
							layoutType,
						);
						nextX = normalized.x;
						nextY = normalized.y;
					}
					posNode.x = nextX;
					posNode.y = nextY;
					currentShiftX = nextX - originalX;
					currentShiftY = nextY - originalY;
				} else {
					posNode.x += shiftX;
					posNode.y += shiftY;
				}
				if (node.expanded !== false && node.children) {
					node.children.forEach((child) => {
						applyCustomPositions(child, positionedMap, currentShiftX, currentShiftY, lockDescendantsToLayout || !!node.floating);
					});
				}
			};
			if (tree.id === "virtual-root") {
				(tree.children || []).forEach((child) => applyCustomPositions(child, positionedById, 0, 0, false, true));
			} else {
				applyCustomPositions(tree, positionedById, 0, 0);
			}
		}

			avoidFloatingNodeOverlaps(positioned, tree, freeLayout);
			routeLayoutPaths({ connections, positioned, positionedById, nodeToMapRoot, autoPositions, layoutType, connectionStyle, freeLayout });
			applyMapLayoutRotations(positioned, connections, nodeToMapRoot, layoutType);
			resolveLayoutGeometry(positioned, connections, nodeToMapRoot, connectionStyle, layoutType, freeLayout, routeCache, autoPositions);
		applyCanonicalLayoutMirrors(positioned, connections, nodeToMapRoot, layoutType);
		avoidLineNodeOverlaps(positioned, connections, nodeToMapRoot);
		resolveCollapseDirections(positioned, nodeToMapRoot, layoutType);

		positioned.forEach((p) => {
			const mapRoot = nodeToMapRoot.get(p.id);
			if (mapRoot) p.mapNodeShape = mapRoot.style?.nodeShape;
			// Keep every render consumer on the same shape resolution as the style
			// panel. SvgNodeItem needs the resolved value for text/background layout,
			// while renderShape resolves it again for the actual SVG outline.
			// Materializing it prevents disagreement for implicit defaults.
			// the global "rounded" setting resolves to the shared rounded rectangle.
			const shape = resolveDefaultNodeShape({
				explicitNodeShape: p.node.style?.shape,
				mapNodeShape: p.mapNodeShape,
				globalNodeShape: defaultNodeShape,
			});
			if (p.node.style?.shape !== shape) {
				p.node = { ...p.node, style: { ...p.node.style, shape } };
			}
		});

		let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
		positioned.forEach((n) => {
			minX = Math.min(minX, n.x);
			maxX = Math.max(maxX, n.x + n.width);
			minY = Math.min(minY, n.y - n.height / 2);
			maxY = Math.max(maxY, n.y + n.height / 2);
		});
		if (minX === Infinity) { minX = 0; maxX = 500; minY = 0; maxY = 300; }

		return { nodes: positioned, paths: connections, bounds: { minX, maxX, minY, maxY }, nodeToMapRoot, fishboneMapRootIds };
}

export function usePageLayout(
	tree: MindmapNode,
	layoutType: LayoutType,
	stylePreset: StylePreset | null,
	connectionStyle: "curved" | "orthogonal" | "straight" = "curved",
	freeLayout = false,
	defaultNodeShape: NodeShapeType = "rounded"
): { nodes: PositionedNode[]; paths: ConnectionPath[]; bounds: { minX: number; maxX: number; minY: number; maxY: number }; fishboneMapRootIds: ReadonlySet<string> } {
	const routeCacheRef = useRef<Map<string, string>>(new Map());
	const structureResult = useMemo(
		() => compilePageLayoutStructure(tree, layoutType, connectionStyle, freeLayout, defaultNodeShape, routeCacheRef.current),
		[tree, layoutType, connectionStyle, freeLayout, defaultNodeShape]
	);

	// Style memo: O(n) color remap — runs only when palette changes, skips expensive layout.
	return useMemo(
		() => applyStylePresetTier(structureResult, stylePreset),
		[structureResult, stylePreset],
	);
}

export type { PositionedNode, ConnectionPath };
