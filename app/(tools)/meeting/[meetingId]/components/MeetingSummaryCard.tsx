"use client";

import { FileText, Loader2 } from "lucide-react";
import { InlineText } from "./InlineText";
import { BilingualText } from "./BilingualText";

/** Summary card: icon + "Summary" header + overview paragraph. When `onSave`
 *  is given (owner/editor — see MeetingOverviewTab.tsx), the paragraph is
 *  edited in place (looks the same as read-only text, saved on blur). */
export function MeetingSummaryCard({
	overview,
	onSave,
	saving,
}: {
	overview: string;
	onSave?: (overview: string) => void;
	saving?: boolean;
}) {
	return (
		<div className="rounded-xl border border-border bg-card p-5">
			<div className="mb-3 flex items-center gap-2">
				<span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-light dark:bg-amber-950/30">
					<FileText className="h-4 w-4 text-primary" />
				</span>
				<h2 className="text-sm font-semibold text-card-foreground">Summary</h2>
				{saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
			</div>
			{onSave ? (
				<div className="text-sm leading-relaxed text-muted-foreground">
					<InlineText value={overview} ariaLabel="Summary" placeholder="No summary available yet." onCommit={onSave} />
				</div>
			) : (
				<p className="text-sm leading-relaxed text-muted-foreground">
					{overview ? <BilingualText text={overview} /> : "No summary available yet."}
				</p>
			)}
		</div>
	);
}
