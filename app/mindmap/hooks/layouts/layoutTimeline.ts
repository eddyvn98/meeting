"use client";

import { MindmapNode } from "@/components/features/chat/mindmap/mindmap-types";
import { PositionedNode, ConnectionPath, pushNode, NODE_WIDTH, X_GAP, Y_GAP, getNodeDimensions, getBranchColor } from "./layoutHelpers";

export type TimelineAxis = "horizontal" | "vertical";
export type TimelineBranchMode = "auto" | "one-side" | "one-side-reverse" | "alternate";
export type TimelineDescendantStyle = "tree" | "hierarchy";
type TimelineLineStyle = "curved" | "orthogonal" | "straight";

const VERT_TIMELINE_GAP = 28;

function timelineBranchSide(mode: TimelineBranchMode, index: number, activityCount: number): 1 | -1 {
	if (mode === "one-side-reverse") return 1;
	if (mode === "alternate" || (mode === "auto" && activityCount > 3)) return index % 2 === 0 ? -1 : 1;
	return -1;
}

function timelineSideKey(side: 1 | -1): 0 | 1 {
	return side > 0 ? 1 : 0;
}

function timelineStyledLine(startX: number, startY: number, endX: number, endY: number, style: TimelineLineStyle) {
	if (style === "straight") return `M ${startX} ${startY} L ${endX} ${endY}`;
	const horizontal = Math.abs(endX - startX) >= Math.abs(endY - startY);
	const offset = 8;
	if (style === "orthogonal") {
		if (Math.abs(startY - endY) < 0.001) return `M ${startX} ${startY} H ${endX}`;
		if (Math.abs(startX - endX) < 0.001) return `M ${startX} ${startY} V ${endY}`;
		if (horizontal) {
			const midX = (startX + endX) / 2;
			return `M ${startX} ${startY} H ${midX} V ${startY + offset} H ${endX} V ${endY}`;
		}
		const midY = (startY + endY) / 2;
		return `M ${startX} ${startY} V ${midY} H ${startX + offset} V ${endY} H ${endX}`;
	}
	if (horizontal) {
		const dx = (endX - startX) * 0.35;
		return `M ${startX} ${startY} C ${startX + dx} ${startY + offset} ${endX - dx} ${endY + offset} ${endX} ${endY}`;
	}
	const dy = (endY - startY) * 0.35;
	return `M ${startX} ${startY} C ${startX + offset} ${startY + dy} ${endX + offset} ${endY - dy} ${endX} ${endY}`;
}

// Same idea as the catalog layout's level-column computation: every node at
// a given depth within one milestone's branch shares one x, sized off the
// widest label at that depth, so the branch reads as straight vertical
// columns instead of indenting a different amount per node's own width.
function computeTimelineLevelWidths(node: MindmapNode, level: number, out: Record<number, number>) {
	const { width } = getNodeDimensions(node);
	out[level] = Math.max(out[level] ?? 0, width);
	if (node.expanded === false || !node.children?.length) return;
	node.children.forEach((child) => computeTimelineLevelWidths(child, level + 1, out));
}

function computeTimelineLevelOffsets(levelWidths: Record<number, number>, rootX: number) {
	const offsets: Record<number, number> = {};
	let cursor = rootX;
	Object.keys(levelWidths).map(Number).sort((a, b) => a - b).forEach((level) => {
		offsets[level] = cursor;
		// A slight gap, not the sibling-subtree X_GAP(65) — this indent only
		// needs to clear the widest label at this depth, not separate two
		// side-by-side branches.
		cursor += levelWidths[level] + 24;
	});
	return offsets;
}

function calcTimelineSubtreeHeights(n: MindmapNode, out: Record<string, number>): number {
	const ownHeight = getNodeDimensions(n).height;
	if (n.expanded === false || !n.children?.length) {
		out[n.id] = ownHeight;
		return ownHeight;
	}
	const childrenHeight = n.children.reduce((s, c) => s + calcTimelineSubtreeHeights(c, out), 0) + (n.children.length - 1) * Y_GAP;
	out[n.id] = ownHeight + Y_GAP + childrenHeight;
	return out[n.id];
}

function layoutTimelineSubtree(
	n: MindmapNode,
	level: number,
	x: number,
	startY: number,
	color: string,
	activeColors: string[],
	subtreeHeights: Record<string, number>,
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	side: 1 | -1 = 1,
	levelOffsets?: Record<number, number>,
	descendantStyle: TimelineDescendantStyle = "tree",
) {
	const offsets = levelOffsets ?? (() => {
		const levelWidths: Record<number, number> = {};
		computeTimelineLevelWidths(n, level, levelWidths);
		return computeTimelineLevelOffsets(levelWidths, x);
	})();
	const { width: ownWidth, height: ownHeight } = getNodeDimensions(n);
	const cy = startY + ownHeight / 2;
	pushNode(positioned, n, level, x, cy, color);

	const collapsed = n.expanded === false;
	if (collapsed || !n.children?.length) return;
	{
		// The spine anchors to this node's own center; the child column comes
		// from the shared per-level offset (computed above), not this node's
		// own width — so every node at the next depth lines up in one straight
		// band regardless of how long any individual ancestor's label is.
		const railX = x + ownWidth / 2;
		// Exit from the edge facing the children (top or bottom, per side), not
		// the node's own vertical center — starting at cy draws half the spine
		// back across the node's own body, the same failure mode as before but
		// on the perpendicular axis.
		const edgeY = side > 0 ? cy + ownHeight / 2 : cy - ownHeight / 2;
		const childX = offsets[level + 1];
		let childY = side > 0 ? startY + ownHeight + Y_GAP : startY - Y_GAP;
		let outermostChildCenterY: number | undefined;

			n.children.forEach((child) => {
			const cc = getBranchColor(child, color);
			const childDims = getNodeDimensions(child);
			const childTopY = side > 0 ? childY : childY - childDims.height;
			let childCy = childTopY + childDims.height / 2;
			// Reserve for the NEXT sibling's start position. In "tree" mode this
			// is the pre-computed (symmetric, sum-of-descendants) subtree height;
			// in "hierarchy" mode the activity's own descendants mostly grow
			// sideways, not downward, so reusing that same sum wildly overstates
			// how much room this activity actually needs — recompute it from the
			// directional hierarchy extent instead.
			let childH = subtreeHeights[child.id];

			if (descendantStyle === "hierarchy") {
				// The milestone→activity hop always stays "tree" (rail + tick) —
				// only an activity's OWN children (level 3+) switch to the
				// centered right-edge-to-left-edge bracket.
				const hierarchyExtents: Record<string, HierarchyExtent> = {};
				const ext = calcHierarchyExtents(child, hierarchyExtents);
				childH = ext.before + ext.after;
				// The activity sits on the MIDLINE of its own descendant band, so
				// its row is the middle of the strip reserved for it — not the
				// strip's leading edge, which would let the band's upper half run
				// back over the previous activity.
				childCy = side > 0 ? childY + ext.before : childY - ext.after;
				pushNode(positioned, child, level + 1, childX, childCy, cc);
				if (child.expanded !== false && child.children?.length) {
					layoutHierarchyDescendants(child, level + 2, childX, childCy, cc, activeColors, hierarchyExtents, positioned, connections, 1, offsets);
				}
			} else {
				layoutTimelineSubtree(child, level + 1, childX, childTopY, cc, activeColors, subtreeHeights, positioned, connections, side, offsets);
			}

			connections.push({
				id: `${n.id}-${child.id}-h`,
				d: `M ${railX} ${childCy} H ${childX}`,
				color: cc,
			});

			outermostChildCenterY = childCy;
			childY = side > 0 ? childY + childH + Y_GAP : childY - childH - Y_GAP;
		});

		if (outermostChildCenterY !== undefined) {
			connections.push({
				id: `${n.id}-v-axis`,
				d: `M ${railX} ${edgeY} V ${outermostChildCenterY}`,
				color: color,
			});
		}
	}
}

interface HierarchyExtent {
	/** How far this node's own band reaches above its center row. */
	before: number;
	/** How far this node's own band reaches below its center row. */
	after: number;
}

/** Rail position inside the gutter just before the child column, so every fork
 *  at one depth folds on the same vertical line. */
const HIERARCHY_RAIL_INSET = 12;
/** Row gap inside a centered hierarchy band. Deliberately wider than the
 *  collision packer's own NODE_GAP(16): anything tighter gets pushed apart
 *  there, and that pass packs downward only — which would tilt the band off the
 *  parent's row after we just centered it. */
const HIERARCHY_ROW_GAP = 20;

// Directional counterpart to calcSubtreeHeights, matching the ACTUAL geometry
// layoutHierarchyDescendants produces: a parent sits on the MIDLINE of its
// children's band, so a subtree needs room on both sides of its own row. This
// still has to recurse through every descendant: a sibling's OWN fork lands in
// the SAME further-out column as every other sibling's fork (they all share
// this node's child column), so without reserving its full depth here, a later
// sibling's descendants can land right on top of it.
function calcHierarchyExtents(node: MindmapNode, out: Record<string, HierarchyExtent>): HierarchyExtent {
	const ownHalf = getNodeDimensions(node).height / 2;
	const children = node.expanded === false ? [] : node.children ?? [];
	if (!children.length) {
		const leaf: HierarchyExtent = { before: ownHalf, after: ownHalf };
		out[node.id] = leaf;
		return leaf;
	}
	let span = 0;
	children.forEach((child, index) => {
		const childExtent = calcHierarchyExtents(child, out);
		span += childExtent.before + childExtent.after + (index ? HIERARCHY_ROW_GAP : 0);
	});
	const half = Math.max(ownHalf, span / 2);
	const extent: HierarchyExtent = { before: half, after: half };
	out[node.id] = extent;
	return extent;
}

// "hierarchy" descendant style: the parent is centered on its children's band
// and the wire runs from the parent's outer edge, folds on a rail in the column
// gutter, and enters the child's near edge — the same bracket the Hierarchy
// layout (and the hierarchy-style Treeview) draws.
//
// `hDir` picks which way the whole chain grows: +1 (right) for everything
// under the horizontal timeline, and for vertical-timeline activities that
// sit on the axis's right side; -1 for activities on the LEFT side, so the
// fork grows further left instead of doubling back across the main axis
// and the milestone column it just branched off of.
function layoutHierarchyDescendants(
	node: MindmapNode,
	level: number,
	nodeX: number,
	nodeY: number,
	color: string,
	activeColors: string[],
	extents: Record<string, HierarchyExtent>,
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	hDir: 1 | -1 = 1,
	levelOffsets?: Record<number, number>,
): number {
	const { width: nodeWidth, height: ownHeight } = getNodeDimensions(node);
	const children = node.expanded === false ? [] : node.children ?? [];
	if (!children.length) return nodeY + ownHeight / 2;
	const parentEdgeX = hDir > 0 ? nodeX + nodeWidth : nodeX;
	// Shared boundary for every child in this generation — their LEFT edge
	// when growing right (so they line up flush-left), their RIGHT edge when
	// growing left (so they line up flush-right); each child's own X is
	// then offset from it by its own width only when growing left.
	const sharedColEdge = hDir > 0 ? levelOffsets?.[level] : undefined;
	const colEdge = sharedColEdge !== undefined
		? sharedColEdge
		: hDir > 0 ? parentEdgeX + X_GAP : parentEdgeX - X_GAP;
	const railX = colEdge - hDir * HIERARCHY_RAIL_INSET;
	const span = children.reduce(
		(total, child, index) => total + extents[child.id].before + extents[child.id].after + (index ? HIERARCHY_ROW_GAP : 0),
		0,
	);
	let cursor = nodeY - span / 2;
	let bottom = nodeY + ownHeight / 2;
	children.forEach((child) => {
		const extent = extents[child.id];
		const childCenterY = cursor + extent.before;
		const cc = getBranchColor(child, color);
		const childWidth = getNodeDimensions(child).width;
		const childX = hDir > 0 ? colEdge : colEdge - childWidth;
		pushNode(positioned, child, level, childX, childCenterY, cc);
		connections.push({
			id: `${node.id}-${child.id}`,
			d: `M ${parentEdgeX} ${nodeY} L ${railX} ${nodeY} L ${railX} ${childCenterY} L ${colEdge} ${childCenterY}`,
			color: cc,
		});
		const childBottom = layoutHierarchyDescendants(child, level + 1, childX, childCenterY, cc, activeColors, extents, positioned, connections, hDir, levelOffsets);
		bottom = Math.max(bottom, childBottom, childCenterY + extent.after);
		cursor = childCenterY + extent.after + HIERARCHY_ROW_GAP;
	});

	return bottom;
}

function layoutVertTimelineDescendants(
	node: MindmapNode,
	level: number,
	nodeX: number,
	nodeY: number,
	side: 1 | -1,
	branchDepth: number,
	color: string,
	activeColors: string[],
	positioned: PositionedNode[],
	connections: ConnectionPath[]
): number {
	const nodeDims = getNodeDimensions(node);
	const ownBottom = nodeY + nodeDims.height / 2;
	const children = node.expanded !== false && node.children ? node.children : [];
	if (!children.length) return ownBottom;
	let childY = nodeY + nodeDims.height / 2 + VERT_TIMELINE_GAP;
	const childX = nodeX + side * (nodeDims.width + X_GAP + branchDepth * 24);
	let bottom = ownBottom;

	children.forEach((child) => {
		const cc = getBranchColor(child, color);
		const childDims = getNodeDimensions(child);
		const childCenterY = childY + childDims.height / 2;
		pushNode(positioned, child, level, childX, childCenterY, cc);
		const parentEdgeX = side > 0 ? nodeX + nodeDims.width : nodeX;
		const childEdgeX = side > 0 ? childX : childX + childDims.width;
		const midX = (parentEdgeX + childEdgeX) / 2;
		connections.push({
			id: `${node.id}-${child.id}`,
			d: `M ${parentEdgeX} ${nodeY} H ${midX} V ${childCenterY} H ${childEdgeX}`,
			color: cc,
		});
		const childBottom = layoutVertTimelineDescendants(child, level + 1, childX, childCenterY, side, branchDepth + 1, cc, activeColors, positioned, connections);
		bottom = Math.max(childBottom, childCenterY + childDims.height / 2);
		childY = bottom + VERT_TIMELINE_GAP;
	});

	return bottom;
}

function runHorizontalTimeline(
	tree: MindmapNode,
	activeColors: string[],
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	startY: number = 40,
	branchMode: TimelineBranchMode = "auto",
	_lineStyle: TimelineLineStyle = "curved",
	descendantStyle: TimelineDescendantStyle = "tree",
) {
	const children = tree.expanded !== false && tree.children ? tree.children : [];
	const axisY = startY + 180;
	const rootDims = getNodeDimensions(tree);

	const subtreeHeights: Record<string, number> = {};
	calcTimelineSubtreeHeights(tree, subtreeHeights);

	pushNode(positioned, tree, 0, 40, axisY, activeColors[0]);

	let prevX = 40 + rootDims.width;
	let prevId = tree.id;
	const firstMilestoneX = 40 + rootDims.width + X_GAP * 2;
	const timelineLevelWidths: Record<number, number> = {};
	children.forEach((child, idx) => computeTimelineLevelWidths(child, idx + 1, timelineLevelWidths));
	const timelineOffsets = computeTimelineLevelOffsets(timelineLevelWidths, firstMilestoneX);
	const nextXBySide: [number, number] = [firstMilestoneX, firstMilestoneX];
	let timelineColumnShift = 0;
	const activityCount = children.reduce((sum, child) => sum + (child.expanded !== false ? child.children?.length ?? 0 : 0), 0);
	children.forEach((child, idx) => {
		const cc = activeColors[idx % activeColors.length];
		const side = timelineBranchSide(branchMode, idx, activityCount);
		const sideKey = timelineSideKey(side);
		const milestoneLevel = idx + 1;
		const baseDesiredX = timelineOffsets[milestoneLevel] ?? firstMilestoneX;
		const desiredX = baseDesiredX + timelineColumnShift;
		// Opposite-side branches do not collide. The global level column gives
		// every later branch the same visual alignment; only a same-side branch
		// that extends farther right is allowed to push that column outward.
		const cx = Math.max(desiredX, nextXBySide[sideKey], prevX);
		const childDims = getNodeDimensions(child);
		const branchShift = cx - baseDesiredX;
		timelineColumnShift = Math.max(timelineColumnShift, branchShift);
		const branchOffsets = Object.fromEntries(
			Object.entries(timelineOffsets).map(([level, offset]) => [
				Number(level),
				Number(level) >= milestoneLevel ? offset + branchShift : offset,
			]),
		) as Record<number, number>;

		connections.push({
			id: `${prevId}-${child.id}-timeline-connector`,
			d: timelineStyledLine(prevX, axisY, cx, axisY, "straight"),
			color: cc,
		});

		const branchStartIdx = positioned.length;
		layoutTimelineSubtree(child, milestoneLevel, cx, axisY - childDims.height / 2, cc, activeColors, subtreeHeights, positioned, connections, side, branchOffsets, descendantStyle);

		let branchMaxRight = cx + childDims.width;
		for (let i = branchStartIdx; i < positioned.length; i++) {
			const p = positioned[i];
			branchMaxRight = Math.max(branchMaxRight, p.x + p.width);
		}

		prevX = cx + childDims.width;
		prevId = child.id;
		nextXBySide[sideKey] = branchMaxRight + X_GAP * 2.5;
	});
}

export function runLayoutTimeline(
	tree: MindmapNode,
	axis: TimelineAxis,
	activeColors: string[],
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	startY: number = 40,
	branchMode: TimelineBranchMode = "auto",
	_lineStyle: TimelineLineStyle = "curved",
	descendantStyle: TimelineDescendantStyle = "tree",
) {
	if (axis === "vertical") {
		runLayoutVertTimeline(tree, activeColors, positioned, connections, startY, branchMode, _lineStyle, descendantStyle);
		return;
	}
	runHorizontalTimeline(tree, activeColors, positioned, connections, startY, branchMode, _lineStyle, descendantStyle);
}

function runLayoutVertTimeline(
	n: MindmapNode,
	activeColors: string[],
	positioned: PositionedNode[],
	connections: ConnectionPath[],
	startY: number = 40,
	branchMode: TimelineBranchMode = "auto",
	_lineStyle: TimelineLineStyle = "curved",
	descendantStyle: TimelineDescendantStyle = "tree",
) {
	const children = n.expanded !== false && n.children ? n.children : [];
	const axisX = 300;

	const rootDims = getNodeDimensions(n);
	const rootY = startY + rootDims.height / 2;
	pushNode(positioned, n, 0, axisX - NODE_WIDTH / 2, rootY, activeColors[0]);

	let prevBottomY = rootY + rootDims.height / 2;
	let prevId = n.id;
	let axisCursorY = rootY + rootDims.height / 2 + Y_GAP * 2;
	const nextYBySide: [number, number] = [axisCursorY, axisCursorY];

	const activityCount = children.reduce((sum, child) => sum + (child.expanded !== false ? child.children?.length ?? 0 : 0), 0);
	children.forEach((child, idx) => {
		const cc = activeColors[idx % activeColors.length];
		const childDims = getNodeDimensions(child);
		const side = timelineBranchSide(branchMode, idx, activityCount);
		const sideKey = timelineSideKey(side);
		// Left and right branches occupy separate vertical tracks. A milestone
		// only waits for the track used by its own branch; the opposite track can
		// continue alongside it without inflating the main spine spacing.
		const currentY = Math.max(axisCursorY, nextYBySide[sideKey]);
		const gcs = child.expanded !== false && child.children ? child.children : [];
		// In hierarchy mode the milestone is centered on its activities' band
		// (see below), which reaches ABOVE its own row by half the band's span —
		// unlike the plain "tree" stub, which only ever grows downward. That
		// upward half must be reserved here, before cy is fixed, or it silently
		// overlaps whatever was already placed above `currentY` on this track.
		let hierarchyExtents: Record<string, HierarchyExtent> | undefined;
		let fanBefore = 0;
		if (descendantStyle === "hierarchy" && gcs.length > 0) {
			hierarchyExtents = {};
			calcHierarchyExtents(child, hierarchyExtents);
			fanBefore = gcs.reduce(
				(total, gc, index) => total + hierarchyExtents![gc.id].before + hierarchyExtents![gc.id].after + (index ? HIERARCHY_ROW_GAP : 0),
				0,
			) / 2;
		}
		const cy = currentY + Math.max(childDims.height / 2, fanBefore);
		const childX = axisX - NODE_WIDTH / 2;
		pushNode(positioned, child, 1, childX, cy, cc);

		const childTopY = cy - childDims.height / 2;
		connections.push({
			id: `${prevId}-${child.id}`,
			d: timelineStyledLine(axisX, prevBottomY, axisX, childTopY, "straight"),
			color: cc,
		});

		prevBottomY = cy + childDims.height / 2;
		prevId = child.id;
		let subtreeBottomY = prevBottomY;

		// Mirror of the horizontal timeline: activities of one milestone stack
		// along the map axis (here: vertically) next to a short branch axis,
		// instead of sprawling sideways one branch width at a time.
		const goRight = side > 0;
		{
			if (descendantStyle === "hierarchy") {
				// Hierarchy style now starts right at the milestone→activity hop
				// (level 1 → level 2) instead of one level later: the milestone is
				// centered on its activities' band the same way an activity used to
				// be centered on its own children's band, and the same recursive
				// layout carries that style into every deeper level automatically.
				if (gcs.length > 0 && hierarchyExtents) {
					const bottom = layoutHierarchyDescendants(child, 2, childX, cy, cc, activeColors, hierarchyExtents, positioned, connections, goRight ? 1 : -1);
					subtreeBottomY = Math.max(subtreeBottomY, bottom);
				}
			} else {
				const milestoneEdgeX = goRight ? childX + childDims.width : childX;
				const branchAxisX = milestoneEdgeX + side * 24;
				let activityTopY = cy + childDims.height / 2 + VERT_TIMELINE_GAP;
				let lastActivityCenterY: number | undefined;
				gcs.forEach((gc) => {
					const gcDims = getNodeDimensions(gc);
					const gcX = goRight ? branchAxisX + 24 : branchAxisX - 24 - gcDims.width;
					const gcY = activityTopY + gcDims.height / 2;
					pushNode(positioned, gc, 2, gcX, gcY, cc);
					connections.push({
						id: `${child.id}-${gc.id}-timeline-activity-stub`,
						d: `M ${milestoneEdgeX} ${cy} H ${branchAxisX} V ${gcY} H ${goRight ? gcX : gcX + gcDims.width}`,
						color: cc,
					});
					lastActivityCenterY = gcY;
					let branchBottomY = gcY + gcDims.height / 2;
					if (gc.children && gc.children.length > 0) {
						const beforeCount = positioned.length;
						layoutVertTimelineDescendants(gc, 3, gcX, gcY, side, 1, cc, activeColors, positioned, connections);
						for (let i = beforeCount; i < positioned.length; i++) {
							const p = positioned[i];
							branchBottomY = Math.max(branchBottomY, p.y + p.height / 2);
						}
					}
					subtreeBottomY = Math.max(subtreeBottomY, branchBottomY);
					activityTopY = branchBottomY + VERT_TIMELINE_GAP;
				});
				if (gcs.length > 0 && lastActivityCenterY !== undefined) {
					connections.push({
						id: `${child.id}-timeline-activity-axis`,
						d: `M ${milestoneEdgeX} ${cy} H ${branchAxisX} V ${lastActivityCenterY}`,
						color: cc,
					});
				}
			}
		}

		nextYBySide[sideKey] = subtreeBottomY + Y_GAP * 3;
		axisCursorY = cy + childDims.height / 2 + Y_GAP * 3;
	});
}

export { fishboneEdgePoint, runLayoutFishbone } from "./layoutFishbone";
