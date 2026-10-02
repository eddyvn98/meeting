"use client";

/** Shown only on a meeting this session hasn't cached yet (see
 *  detailCache in page.tsx) — mirrors the real layout (header, audio bar,
 *  tab content) so the swap to real content doesn't jump around. */
export function MeetingDetailSkeleton() {
	return (
		<div className="flex flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
			<div className="flex items-center justify-between gap-4">
				<div className="h-6 w-48 animate-pulse rounded-md bg-muted" />
				<div className="flex gap-2">
					<div className="h-8 w-8 animate-pulse rounded-md bg-muted" />
					<div className="h-8 w-8 animate-pulse rounded-md bg-muted" />
				</div>
			</div>
			<div className="h-14 w-full animate-pulse rounded-xl bg-muted" />
			<div className="flex flex-col gap-3">
				<div className="h-4 w-full animate-pulse rounded bg-muted" />
				<div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
				<div className="h-4 w-full animate-pulse rounded bg-muted" />
				<div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
				<div className="h-4 w-full animate-pulse rounded bg-muted" />
				<div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
			</div>
		</div>
	);
}
