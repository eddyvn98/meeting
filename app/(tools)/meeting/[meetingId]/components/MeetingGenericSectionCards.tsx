"use client";

import { ListChecks, Quote } from "lucide-react";
import type { TextSectionItem } from "@/lib/meeting/overviewSections";
import { CollapsibleSectionBody } from "./CollapsibleSectionBody";
import { EditableTextList } from "./EditableTextList";
import { SectionCardHeader, type SectionEdit } from "./SectionCardHeader";
import { BilingualText } from "./BilingualText";

/** Generic bulleted-text section card (first lines + "Show more" dialog, see
 *  CollapsibleSectionBody.tsx), used for any overview section kind
 *  whose items are just `{ id, text }` and has no dedicated card of its own
 *  (key_points, open_questions, feedback, quotes, custom_text) — see the
 *  kind -> renderer registry in MeetingOverviewTab.tsx. Decisions/Blockers
 *  keep their own cards (MeetingDecisionsCard.tsx, MeetingBlockersCard.tsx)
 *  since those predate this generic one and have their own color styling. */
export function MeetingTextListCard({ title, items, edit }: { title: string; items: TextSectionItem[]; edit?: SectionEdit<TextSectionItem> }) {
	return (
		<div className="group/card flex flex-col rounded-xl border border-border bg-card p-4">
			<SectionCardHeader icon={<ListChecks className="h-4 w-4 shrink-0 text-primary" />} title={title} edit={edit} />

			<CollapsibleSectionBody title={title}>
				{edit ? (
					<EditableTextList items={items} onChange={edit.onItemsChange} listClassName="list-disc space-y-2 pl-4 text-sm text-foreground" emptyLabel="Nothing here yet." />
				) : items.length === 0 ? (
					<p className="py-4 text-sm text-muted-foreground">Nothing here yet.</p>
				) : (
					<ul className="list-disc space-y-2 pl-4 text-sm text-foreground">
						{items.map((item) => (
							<li key={item.id}><BilingualText text={item.text} /></li>
						))}
					</ul>
				)}
			</CollapsibleSectionBody>
		</div>
	);
}

/** Quotes section card: reuses the generic text list but with a quote icon
 *  and italic body text. */
export function MeetingQuotesCard({ title, items, edit }: { title: string; items: TextSectionItem[]; edit?: SectionEdit<TextSectionItem> }) {
	return (
		<div className="group/card flex flex-col rounded-xl border border-border bg-card p-4">
			<SectionCardHeader icon={<Quote className="h-4 w-4 shrink-0 text-primary" />} title={title} edit={edit} />
			<CollapsibleSectionBody title={title}>
				{edit ? (
					<EditableTextList items={items} onChange={edit.onItemsChange} listClassName="flex flex-col gap-2 text-sm italic text-muted-foreground" emptyLabel="Nothing here yet." />
				) : items.length === 0 ? (
					<p className="py-4 text-sm text-muted-foreground">Nothing here yet.</p>
				) : (
					<ul className="flex flex-col gap-2">
						{items.map((item) => (
							<li key={item.id} className="text-sm italic text-muted-foreground">
								“<BilingualText text={item.text} />”
							</li>
						))}
					</ul>
				)}
			</CollapsibleSectionBody>
		</div>
	);
}
