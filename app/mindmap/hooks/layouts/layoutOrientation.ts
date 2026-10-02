const NATIVE_DIRECTION: Record<string, number> = {
	"logical-right": 0,
	"logical-left": 180,
	mindmap: 0,
	"org-chart": 90,
	catalog: 90,
	timeline: 0,
	"vertical-timeline": 90,
	fishbone: 0,
	flowchart: 90,
	swimlane: 90,
};

export function normalizeOrientationAngle(angle: number) {
	return ((angle % 360) + 360) % 360;
}

export function nativeLayoutDirection(layoutType?: string) {
	return NATIVE_DIRECTION[layoutType ?? "logical-right"] ?? 0;
}

/** Stored angles are absolute parent-to-child directions, not relative rotations. */
export function resolvedLayoutDirection(layoutType?: string, angle?: number) {
	return angle === undefined
		? nativeLayoutDirection(layoutType)
		: normalizeOrientationAngle(angle);
}

/** Converts the absolute UI direction into the rotation required by a native layout. */
export function layoutRotationAngle(layoutType?: string, angle?: number) {
	return normalizeOrientationAngle(
		resolvedLayoutDirection(layoutType, angle) - nativeLayoutDirection(layoutType),
	);
}
