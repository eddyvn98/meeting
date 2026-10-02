"use client";

import { useState } from "react";
import { Gavel } from "lucide-react";
import type { TextSectionItem } from "@/lib/meeting/overviewSections";
import { CollapsibleSectionBody } from "./CollapsibleSectionBody";
import { EditableTextList } from "./EditableTextList";
import { SectionCardHeader, type SectionEdit } from "./SectionCardHeader";
import { BilingualText } from "./BilingualText";
import { AddItemButton } from "./AddItemButton";

const LIST_CLASS = "list-disc space-y-2 pl-4 text-sm text-foreground";

/** "Decisions" section card: bulleted list showing the first lines, with a
 *  "Show more" dialog for the rest — see CollapsibleSectionBody.tsx. With
 *  `edit`, bullets are edited in place. Renders the `decisions` overview section kind — see
 *  lib/meeting/overviewSections.ts. */
export function MeetingDecisionsCard({ decisions, title = "Decisions", edit }: { decisions: TextSectionItem[]; title?: string; edit?: SectionEdit<TextSectionItem> }) {
	const [addRequestKey, setAddRequestKey] = useState(0);
	return (
		<div className="group/card flex flex-col rounded-xl border border-border bg-card p-4">
			<SectionCardHeader icon={<Gavel className="h-4 w-4 shrink-0 text-primary" />} title={title} edit={edit} />

			<CollapsibleSectionBody title={title} footer={edit ? <AddItemButton onClick={() => setAddRequestKey((value) => value + 1)} /> : undefined}>
				{edit ? (
					<EditableTextList items={decisions} onChange={edit.onItemsChange} listClassName={LIST_CLASS} emptyLabel="No decisions yet." addRequestKey={addRequestKey} />
				) : decisions.length === 0 ? (
					<p className="py-4 text-sm text-muted-foreground">No decisions yet.</p>
				) : (
					<ul className={LIST_CLASS}>
						{decisions.map((decision) => (
							<li key={decision.id}><BilingualText text={decision.text} /></li>
						))}
					</ul>
				)}
			</CollapsibleSectionBody>
		</div>
	);
}
