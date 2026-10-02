import type { Topic, TranscriptSegment } from "@/lib/meeting/types";
import { formatClock } from "@/lib/meeting/format";
import { BilingualText } from "./BilingualText";

/**
 * Right-column Timeline card: dot-and-line vertical list, bold timestamp +
 * label per spec. `lib/meeting/types.ts` has no dedicated "timeline entry"
 * entity — the data-model agent modeled `Topic` as
 * `{ id, title, evidenceSegmentIds, order }` with no timestamp of its own.
 * We derive a rough timestamp per topic by resolving its first evidence
 * segment against `transcriptSegments` and reading that segment's
 * `startTimeMs`. Topics with no resolvable evidence are dropped from the
 * timeline rather than shown with a fabricated time.
 */
export function MeetingTimelineCard({
	topics,
	segments,
}: {
	topics: Topic[];
	segments: TranscriptSegment[];
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
			<h3 className="mb-3 text-sm font-semibold text-card-foreground">
				Timeline
			</h3>

			{entries.length === 0 ? (
				<p className="py-4 text-sm text-muted-foreground">
					No timeline entries yet.
				</p>
			) : (
				<ol className="relative ml-1.5 border-l border-border pl-4">
					{entries.map((entry) => (
						<li key={entry.id} className="relative pb-4 last:pb-0">
							<span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
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
