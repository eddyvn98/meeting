import type { NodeShapeType, NodeStyle } from "@/components/features/chat/mindmap/mindmap-types";

export const LARK_PRIMARY_BLUE = "#3370ff";

export const DEFAULT_BRANCH_COLORS = [
	LARK_PRIMARY_BLUE,
	LARK_PRIMARY_BLUE,
	LARK_PRIMARY_BLUE,
	LARK_PRIMARY_BLUE,
	LARK_PRIMARY_BLUE,
	LARK_PRIMARY_BLUE,
	LARK_PRIMARY_BLUE,
	LARK_PRIMARY_BLUE,
] as const;

interface ResolveDefaultNodeShapeOptions {
	explicitNodeShape?: NodeShapeType;
	mapNodeShape?: NodeShapeType;
	globalNodeShape: NodeShapeType;
}

export function resolveDefaultNodeShape({
	explicitNodeShape,
	mapNodeShape,
	globalNodeShape,
}: ResolveDefaultNodeShapeOptions): NodeShapeType {
	if (explicitNodeShape) return explicitNodeShape;
	if (mapNodeShape) return mapNodeShape;
	if (globalNodeShape !== "rounded") return globalNodeShape;
	// The default toolbar choice is a rounded rectangle for every node.
	return "rounded_rect";
}

export interface EffectiveNodeStyleOptions {
	style?: NodeStyle | null;
	level: number;
	branchColor: string;
	globalNodeShape: NodeShapeType;
	mapNodeShape?: NodeShapeType;
	rootBg?: string;
	rootBorder?: string;
}

export interface EffectiveNodeVisualStyle {
	shape: NodeShapeType;
	bgColor: string;
	bgOpacity: number;
	borderColor: string;
	borderWidth: number;
	borderDash: NonNullable<NodeStyle["borderDash"]>;
	hasBackground: boolean;
}

export function resolveEffectiveNodeStyle({
	style: rawStyle = {},
	level,
	branchColor,
	globalNodeShape,
	mapNodeShape,
	rootBg = "var(--mindmap-root-bg, #ffffff)",
	rootBorder = "var(--mindmap-root-border, #3370ff)",
}: EffectiveNodeStyleOptions): EffectiveNodeVisualStyle {
	const style = rawStyle ?? {};
	const shape = resolveDefaultNodeShape({
		explicitNodeShape: style.shape,
		mapNodeShape,
		globalNodeShape,
	});
	const customBgColor = style.bgColor ?? style.color;
	const hasBackground = shape !== "underline" && shape !== "text" || Boolean(customBgColor);
	const bgColor = hasBackground
		? level === 0
			? customBgColor ?? rootBg
			: customBgColor ?? (level === 1 ? `${branchColor}15` : `${branchColor}08`)
		: "none";
	const borderColor = shape === "text"
		? style.borderColor === "none" ? "none" : style.borderColor ?? "none"
		: style.borderColor === "none"
			? "none"
			: style.borderColor ?? style.color ?? (level === 0 ? rootBorder : branchColor);

	return {
		shape,
		bgColor,
		bgOpacity: style.bgOpacity ?? 100,
		borderColor,
		borderWidth: style.borderWidth ?? 1.5,
		borderDash: style.borderDash ?? "solid",
		hasBackground,
	};
}
