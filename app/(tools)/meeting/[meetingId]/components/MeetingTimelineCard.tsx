"use client";

import { Loader2, Sparkles } from "lucide-react";
import type { Topic, TranscriptSegment } from "@/lib/meeting/types";
import { formatClock } from "@/lib/meeting/format";
import { BilingualText } from "./BilingualText";

/**
 * Right-column Timeline card: dot-and-line vertical list. Topic timestamps are
 * derived from each topic's first evidence segment. Owner/editors can rebuild
 * only the Timeline from the saved transcript without resetting Summary or
 * any dynamic Overview section.
 */
export function MeetingTimelineCard({
	topics,
	segments,
	onRegenerate,
	regenerating,
}: {
	topics: Topic[];
	segments: TranscriptSegment[];
	onRegenerate?: () => void;
	regenerating?: boolean;
}) {
	const segmentById = new Map(segments.map((s) => [s.id, s]));
	const entries = topics
		.map((topic) => {
			const firstSegment = topic.evidenceSegmentIds
				.map((id) => segmentById.get(id))
				.find((s): s is TranscriptSegment => Boolean(s));
			return firstSegment
				? { id: topic.id, title: topic.title, timeMs: firstSegment.startTimeMs }
				: null;
		})
		.filter((e): e is { id: string; title: string; timeMs: number } => e !== null)
		.sort((a, b) => a.timeMs - b.timeMs);

	return (
		<div className="rounded-xl border border-border bg-card p-4">
			<div className="mb-3 flex items-center gap-2">
				<h3 className="text-sm font-semibold text-card-foreground">Timeline</h3>
				<div className="ml-auto">
					{regenerating ? (
						<span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground" role="status">
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
							AI generating…
						</span>
					) : onRegenerate ? (
						<button
							type="button"
							onClick={onRegenerate}
							className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							title="Regenerate timeline with AI"
						>
							<Sparkles className="h-3.5 w-3.5" />
							Regenerate
						</button>
					) : null}
				</div>
			</div>

			{entries.length === 0 ? (
				<p className="py-4 text-sm text-muted-foreground">
					No timeline entries yet.
				</p>
			) : (
				<ol className="relative ml-1.5 border-l border-border pl-4">
					{entries.map((entry) => (
						<li key={entry.id} className="relative pb-4 last:pb-0">
							<span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-card bg-brand-orange" />
							<p className="text-xs font-bold text-foreground">
								{formatClock(entry.timeMs)}
							</p>
							<p className="text-sm text-muted-foreground"><BilingualText text={entry.title} /></p>
						</li>
					))}
				</ol>
			)}
		</div>
	);
}
