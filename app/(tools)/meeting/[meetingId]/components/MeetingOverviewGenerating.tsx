"use client";

import { Loader2, Sparkles } from "lucide-react";

/** Shown on the Overview tab while the AI overview is still being written:
 *  a pulsing header and shimmering placeholder cards, so the empty tab reads
 *  as "working" instead of "nothing here". */
export function MeetingOverviewGenerating() {
	return (
		<div className="flex flex-col gap-4" role="status" aria-live="polite">
			<div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
				<span className="relative flex h-8 w-8 items-center justify-center">
					<span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
					<Sparkles className="relative h-4 w-4 animate-pulse text-primary" />
				</span>
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium text-foreground">Writing the overview…</p>
					<p className="text-xs text-muted-foreground">The transcript is ready. The summary appears here as soon as the AI finishes.</p>
				</div>
				<Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
			</div>
			<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
				<div className="flex flex-col gap-4 lg:col-span-2">
					<ShimmerCard lines={4} />
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<ShimmerCard lines={3} />
						<ShimmerCard lines={3} />
					</div>
				</div>
				<ShimmerCard lines={6} />
			</div>
		</div>
	);
}

function ShimmerCard({ lines }: { lines: number }) {
	return (
		<div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4">
			<div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
			{Array.from({ length: lines }, (_, i) => (
				<div key={i} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${92 - ((i * 13) % 40)}%`, animationDelay: `${i * 120}ms` }} />
			))}
		</div>
	);
}
