// Shared node content-sizing core, used by every mindmap layout engine in the
// app (the full-page /mindmap tool's layoutHelpers.ts, and the chat-inline
// preview/card layouts). Both surfaces render the same MindmapNode.topic /
// description text and need to grow a node's box to fit long content instead
// of clipping or overlapping neighbors — this is the one place that math
// lives, so a fix here (or a future content-sizing change) applies everywhere
// instead of having to be re-applied per layout file.

export const NODE_CONTENT_BORDER_GAP = 6;

export function growWidthForTopic(topic: string, baseWidth: number, maxWidth = 500): number {
	if (topic.length <= 200) return baseWidth;
	return Math.min(maxWidth, baseWidth + Math.floor((topic.length - 200) * 1.5));
}

// Estimates how many lines `topic` (plus optional `description`) will wrap
// into at `availableTextWidth` px, then returns the height needed to fit
// them on top of `baseHeight`. `fontSize` should match whatever the caller
// actually renders topic text at.
export function estimateContentHeight(
	topic: string,
	description: string | undefined,
	availableTextWidth: number,
	baseHeight: number,
	fontSize = 10.5,
	padding = 0,
): number {
	const effectivePadding = Math.max(0, padding);
	const effectiveTextWidth = Math.max(15, availableTextWidth - effectivePadding * 2);
	const charWidth = fontSize * 0.52;
	const topicLines = topic.split("\n");
	let estimatedTopicLines = 0;
	topicLines.forEach((line) => {
		const charsPerLine = Math.max(10, Math.floor(effectiveTextWidth / charWidth));
		estimatedTopicLines += Math.max(1, Math.ceil(line.length / charsPerLine));
	});
	let textHeight = estimatedTopicLines * (fontSize * 1.35) + 12 + effectivePadding * 2;
	if (description) {
		const availableDescWidth = Math.max(15, effectiveTextWidth - 10);
		const charsPerLine = Math.max(15, Math.floor(availableDescWidth / 5.3));
		// Per paragraph, not per total character count: a description renders one
		// line box per newline (blank lines included, see LinkifiedText), so
		// counting the whole string as one long run under-measured every
		// multi-paragraph description and clipped its last lines. The ￼
		// placeholders are embedded images, whose own height the caller adds.
		const descLines = description.split("\n").reduce((sum, line) => {
			const text = line.replace(/￼/g, "");
			return sum + Math.max(1, Math.ceil(text.length / charsPerLine));
		}, 0);
		textHeight += descLines * 13.5 + 10;
	}

	return Math.max(baseHeight, textHeight + NODE_CONTENT_BORDER_GAP * 2);
}

export function estimateFreeFormNodeHeight(
	topic: string,
	description: string | undefined,
	width: number,
	currentHeight: number,
	shape = "rounded",
	fontSize = 10.5,
	padding = 0,
): number {
	const availableTextWidth = shape === "diamond"
		? width * 0.52
		: shape === "triangle"
			? width * 0.45
			: shape === "hexagon"
				? width * 0.55
				: shape === "parallelogram"
					? width * 0.70
					: shape === "oval"
						? width * 0.75
						: shape === "cloud_rect"
							? width * 0.76
							: shape === "pill"
								? width - 36
								: width - 12;
	const contentHeight = estimateContentHeight(topic, description, Math.max(15, availableTextWidth), 0, fontSize, padding);
	const requiredHeight = shape === "diamond"
		? Math.ceil(contentHeight / 0.48)
		: shape === "hexagon"
			? Math.ceil(contentHeight / 0.80)
			: shape === "oval"
				? Math.ceil(contentHeight / 0.75)
				: shape === "circle"
					? Math.ceil(contentHeight / 0.707)
					: shape === "cloud_rect"
						? Math.ceil(contentHeight / 0.76)
						: shape === "parallelogram"
							? contentHeight + 8
							: shape === "speech_bubble"
								? contentHeight + 18
								: shape === "cylinder"
									? contentHeight + 16
									: shape === "pill"
										? contentHeight + 12
										: contentHeight;
		return Math.max(currentHeight, requiredHeight);
}
