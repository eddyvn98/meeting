"use client";

import { useState } from "react";
import { CheckSquare } from "lucide-react";
import type { ActionSectionItem } from "@/lib/meeting/overviewSections";
import { avatarPaletteFor, formatDeadline, initialsOf } from "@/lib/meeting/format";
import { CollapsibleSectionBody } from "./CollapsibleSectionBody";
import { AddItemButton } from "./AddItemButton";
import { BilingualText } from "./BilingualText";
import { InlineText } from "./InlineText";
import { SectionCardHeader, type SectionEdit } from "./SectionCardHeader";
import { blankItemFor } from "./sectionBlankItems";

function ActionItemRow({ item }: { item: ActionSectionItem }) {
	const owner = item.owner ?? "?";
	const due = formatDeadline(item.deadline);
	return (
		<li className="flex items-start gap-2.5">
			<span
				className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${avatarPaletteFor(owner)}`}
			>
				{initialsOf(owner)}
			</span>
			<span className="flex-1 text-sm text-foreground"><BilingualText text={item.task} /></span>
			{due && <span className="shrink-0 text-xs text-muted-foreground">{due}</span>}
		</li>
	);
}

/** Editable row: same avatar / task / due layout as ActionItemRow, with the task
 *  edited in place and Owner / Deadline fields revealed while the row is hovered
 *  or focused (or when set). Clearing the task deletes the item. */
function EditableActionRow({ item, autoFocus, onChange, onDelete }: { item: ActionSectionItem; autoFocus: boolean; onChange: (next: ActionSectionItem) => void; onDelete: () => void }) {
	const owner = item.owner ?? "?";
	const due = formatDeadline(item.deadline);
	const metaVisible = item.owner || item.deadline ? "flex" : "hidden group-hover/row:flex group-focus-within/row:flex";
	return (
		<li className="group/row flex items-start gap-2.5">
			<span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${avatarPaletteFor(owner)}`}>{initialsOf(owner)}</span>
			<div className="min-w-0 flex-1">
				<div className="text-sm text-foreground">
					<InlineText value={item.task} autoFocus={autoFocus} selectOnFocus onCommit={(t) => (t.trim() ? onChange({ ...item, task: t }) : onDelete())} />
				</div>
				<div className={`${metaVisible} gap-2 text-xs text-muted-foreground`}>
					<div className="min-w-0 flex-1">
						<InlineText value={item.owner ?? ""} placeholder="Owner" onCommit={(t) => onChange({ ...item, owner: t.trim() || null })} />
					</div>
					<div className="min-w-0 flex-1">
						<InlineText value={item.deadline ?? ""} placeholder="Deadline" onCommit={(t) => onChange({ ...item, deadline: t.trim() || null })} />
					</div>
				</div>
			</div>
			{due && <span className="shrink-0 text-xs text-muted-foreground group-hover/row:hidden group-focus-within/row:hidden">{due}</span>}
		</li>
	);
}

/** "Action Items" section card: colored initials avatar + task text + due
 *  date per row, showing the first lines with a "Show more" dialog for the
 *  rest — see CollapsibleSectionBody.tsx. Renders the
 *  `actions` overview section kind — see lib/meeting/overviewSections.ts. */
export function MeetingActionItemsCard({ items, title = "Action Items", edit }: { items: ActionSectionItem[]; title?: string; edit?: SectionEdit<ActionSectionItem> }) {
	const [focusId, setFocusId] = useState<string | null>(null);

	return (
		<div className="group/card flex flex-col rounded-xl border border-border bg-card p-4">
			<SectionCardHeader icon={<CheckSquare className="h-4 w-4 shrink-0 text-primary" />} title={title} edit={edit} />

			<CollapsibleSectionBody
				title={title}
				footer={
					edit ? (
						<AddItemButton
							onClick={() => {
								const item = blankItemFor("actions") as ActionSectionItem;
								setFocusId(item.id);
								edit.onItemsChange([...items, item]);
							}}
						/>
					) : undefined
				}
			>
				{edit && items.length > 0 ? (
					<ul className="flex flex-col gap-3">
						{items.map((item) => (
							<EditableActionRow
								key={item.id}
								item={item}
								autoFocus={focusId === item.id}
								onChange={(next) => edit.onItemsChange(items.map((i) => (i.id === item.id ? next : i)))}
								onDelete={() => edit.onItemsChange(items.filter((i) => i.id !== item.id))}
							/>
						))}
					</ul>
				) : items.length === 0 ? (
					<p className="py-4 text-sm text-muted-foreground">No action items yet.</p>
				) : (
					<ul className="flex flex-col gap-3">
						{items.map((item) => (
							<ActionItemRow key={item.id} item={item} />
						))}
					</ul>
				)}
			</CollapsibleSectionBody>
		</div>
	);
}
