"use client";

import { useState } from "react";
import { HelpCircle, Scale, Gauge } from "lucide-react";
import type { MetricSectionItem, OptionsCompareSectionItem, QaSectionItem } from "@/lib/meeting/overviewSections";
import { AddItemButton } from "./AddItemButton";
import { CollapsibleSectionBody } from "./CollapsibleSectionBody";
import { InlineText } from "./InlineText";
import { SectionCardHeader, type SectionEdit } from "./SectionCardHeader";
import { blankItemFor } from "./sectionBlankItems";
import { BilingualText } from "./BilingualText";

const splitList = (text: string): string[] =>
	text
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

/** Q&A section card: question in bold, answer underneath. With `edit`, both are
 *  edited in place; clearing a question deletes the item. */
export function MeetingQaCard({ title, items, edit }: { title: string; items: QaSectionItem[]; edit?: SectionEdit<QaSectionItem> }) {
	const [focusId, setFocusId] = useState<string | null>(null);
	const update = (id: string, patch: Partial<QaSectionItem>) => edit?.onItemsChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));

	return (
		<div className="group/card flex flex-col rounded-xl border border-border bg-card p-4">
			<SectionCardHeader icon={<HelpCircle className="h-4 w-4 shrink-0 text-brand-orange" />} title={title} edit={edit} />
			<CollapsibleSectionBody
				title={title}
				footer={
					edit ? (
						<AddItemButton
							onClick={() => {
								const item = blankItemFor("qa") as QaSectionItem;
								setFocusId(item.id);
								edit.onItemsChange([...items, item]);
							}}
						/>
					) : undefined
				}
			>
				{items.length === 0 ? (
					<p className="py-4 text-sm text-muted-foreground">Nothing here yet.</p>
				) : (
					<ul className="flex flex-col gap-3">
						{items.map((item) => (
							<li key={item.id} className="text-sm">
								{edit ? (
									<>
										<div className="font-medium text-foreground">
											<InlineText
												value={item.question}
												autoFocus={focusId === item.id}
												selectOnFocus
												onCommit={(t) => (t.trim() ? update(item.id, { question: t }) : edit.onItemsChange(items.filter((i) => i.id !== item.id)))}
											/>
										</div>
										<div className="text-muted-foreground">
											<InlineText value={item.answer} placeholder="Answer" onCommit={(t) => update(item.id, { answer: t })} />
										</div>
									</>
								) : (
									<>
										<p className="font-medium text-foreground"><BilingualText text={item.question} /></p>
										{item.answer && <p className="text-muted-foreground"><BilingualText text={item.answer} /></p>}
									</>
								)}
							</li>
						))}
					</ul>
				)}
			</CollapsibleSectionBody>
		</div>
	);
}

/** Options-compared section card: one block per option with pros/cons
 *  columns. With `edit`, the option name and the comma-separated pros/cons are
 *  edited in place; clearing an option name deletes the item. */
export function MeetingOptionsCompareCard({ title, items, edit }: { title: string; items: OptionsCompareSectionItem[]; edit?: SectionEdit<OptionsCompareSectionItem> }) {
	const [focusId, setFocusId] = useState<string | null>(null);
	const update = (id: string, patch: Partial<OptionsCompareSectionItem>) => edit?.onItemsChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));

	return (
		<div className="group/card flex flex-col rounded-xl border border-border bg-card p-4">
			<SectionCardHeader icon={<Scale className="h-4 w-4 shrink-0 text-brand-orange" />} title={title} edit={edit} />
			<CollapsibleSectionBody
				title={title}
				footer={
					edit ? (
						<AddItemButton
							onClick={() => {
								const item = blankItemFor("options_compare") as OptionsCompareSectionItem;
								setFocusId(item.id);
								edit.onItemsChange([...items, item]);
							}}
						/>
					) : undefined
				}
			>
				{items.length === 0 ? (
					<p className="py-4 text-sm text-muted-foreground">Nothing here yet.</p>
				) : (
					<ul className="flex flex-col gap-3">
						{items.map((item) => (
							<li key={item.id} className="text-sm">
								{edit ? (
									<>
										<div className="font-medium text-foreground">
											<InlineText
												value={item.option}
												autoFocus={focusId === item.id}
												selectOnFocus
												onCommit={(t) => (t.trim() ? update(item.id, { option: t }) : edit.onItemsChange(items.filter((i) => i.id !== item.id)))}
											/>
										</div>
										<div className="text-muted-foreground">
											<InlineText value={item.pros.join(", ")} placeholder="Pros, comma-separated" onCommit={(t) => update(item.id, { pros: splitList(t) })} />
										</div>
										<div className="text-muted-foreground">
											<InlineText value={item.cons.join(", ")} placeholder="Cons, comma-separated" onCommit={(t) => update(item.id, { cons: splitList(t) })} />
										</div>
									</>
								) : (
									<>
										<p className="font-medium text-foreground"><BilingualText text={item.option} /></p>
										{item.pros.length > 0 && <p className="text-muted-foreground">Pros: {item.pros.join(", ")}</p>}
										{item.cons.length > 0 && <p className="text-muted-foreground">Cons: {item.cons.join(", ")}</p>}
									</>
								)}
							</li>
						))}
					</ul>
				)}
			</CollapsibleSectionBody>
		</div>
	);
}

/** Metrics section card: label/value pairs in a compact grid. With `edit`,
 *  label and value are edited in place; clearing a label deletes the item. */
export function MeetingMetricsCard({ title, items, edit }: { title: string; items: MetricSectionItem[]; edit?: SectionEdit<MetricSectionItem> }) {
	const [focusId, setFocusId] = useState<string | null>(null);
	const update = (id: string, patch: Partial<MetricSectionItem>) => edit?.onItemsChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));

	return (
		<div className="group/card flex flex-col rounded-xl border border-border bg-card p-4">
			<SectionCardHeader icon={<Gauge className="h-4 w-4 shrink-0 text-brand-orange" />} title={title} edit={edit} />
			<CollapsibleSectionBody
				title={title}
				footer={
					edit ? (
						<AddItemButton
							onClick={() => {
								const item = blankItemFor("metrics") as MetricSectionItem;
								setFocusId(item.id);
								edit.onItemsChange([...items, item]);
							}}
						/>
					) : undefined
				}
			>
				{items.length === 0 ? (
					<p className="py-4 text-sm text-muted-foreground">Nothing here yet.</p>
				) : (
					<dl className="grid grid-cols-2 gap-3 text-sm">
						{items.map((item) => (
							<div key={item.id}>
								{edit ? (
									<>
										<dt className="text-xs text-muted-foreground">
											<InlineText
												value={item.label}
												autoFocus={focusId === item.id}
												selectOnFocus
												onCommit={(t) => (t.trim() ? update(item.id, { label: t }) : edit.onItemsChange(items.filter((i) => i.id !== item.id)))}
											/>
										</dt>
										<dd className="font-semibold text-foreground">
											<InlineText value={item.value} placeholder="Value" onCommit={(t) => update(item.id, { value: t })} />
										</dd>
									</>
								) : (
									<>
										<dt className="text-xs text-muted-foreground"><BilingualText text={item.label} /></dt>
										<dd className="font-semibold text-foreground">{item.value}</dd>
									</>
								)}
							</div>
						))}
					</dl>
				)}
			</CollapsibleSectionBody>
		</div>
	);
}
