"use client";

import { FileText, Loader2, Sparkles } from "lucide-react";
import { InlineText } from "./InlineText";
import { BilingualText } from "./BilingualText";

/** Summary card: icon + "Summary" header + overview paragraph. Owner/editors
 *  can edit the prose in place and explicitly rebuild only this summary from
 *  the saved transcript with AI. */
export function MeetingSummaryCard({
	overview,
	onSave,
	saving,
	onRegenerate,
	regenerating,
}: {
	overview: string;
	onSave?: (overview: string) => void;
	saving?: boolean;
	onRegenerate?: () => void;
	regenerating?: boolean;
}) {
	return (
		<div className="rounded-xl border border-border bg-card p-5">
			<div className="mb-3 flex items-center gap-2">
				<span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-light dark:bg-amber-950/30">
					<FileText className="h-4 w-4 text-primary" />
				</span>
				<h2 className="text-sm font-semibold text-card-foreground">Summary</h2>
				{saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
				<div className="ml-auto flex items-center">
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
							title="Regenerate summary with AI"
						>
							<Sparkles className="h-3.5 w-3.5" />
							Regenerate
						</button>
					) : null}
				</div>
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
