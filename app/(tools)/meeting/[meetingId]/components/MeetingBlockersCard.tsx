"use client";

import { AlertTriangle } from "lucide-react";
import type { TextSectionItem } from "@/lib/meeting/overviewSections";
import { CollapsibleSectionBody } from "./CollapsibleSectionBody";
import { EditableTextList } from "./EditableTextList";
import { SectionCardHeader, type SectionEdit } from "./SectionCardHeader";
import { BilingualText } from "./BilingualText";

const LIST_CLASS = "list-disc space-y-2 pl-4 text-sm text-red-700 dark:text-red-400";

/** "Blockers" section card: red-tinted bulleted list showing the first
 *  lines, with a "Show more" dialog for the rest — see
 *  CollapsibleSectionBody.tsx. Red shade (`text-red-600` / dark:`text-red-400`)
 *  is the module's pick since no Processing-screen green token existed yet to
 *  match against — reconcile with that agent's green shade if one lands.
 *  With `edit`, bullets are edited in place and the full list is shown.
 *  Renders the `blockers` overview section kind, and is also reused for
 *  `risks` (same red-flag styling) — see lib/meeting/overviewSections.ts. */
export function MeetingBlockersCard({ blockers, title = "Blockers", edit }: { blockers: TextSectionItem[]; title?: string; edit?: SectionEdit<TextSectionItem> }) {
	const lowerTitle = title.toLowerCase();

	return (
		<div className="group/card flex flex-col rounded-xl border border-border bg-card p-4">
			<SectionCardHeader icon={<AlertTriangle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />} title={title} edit={edit} />

			<CollapsibleSectionBody title={title}>
				{edit ? (
					<EditableTextList items={blockers} onChange={edit.onItemsChange} listClassName={LIST_CLASS} emptyLabel={`No ${lowerTitle} yet.`} />
				) : blockers.length === 0 ? (
					<p className="py-4 text-sm text-muted-foreground">No {lowerTitle} yet.</p>
				) : (
					<ul className={LIST_CLASS}>
						{blockers.map((blocker) => (
							<li key={blocker.id}><BilingualText text={blocker.text} /></li>
						))}
					</ul>
				)}
			</CollapsibleSectionBody>
		</div>
	);
}
