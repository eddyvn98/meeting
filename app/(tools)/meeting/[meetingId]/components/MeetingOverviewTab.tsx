"use client";

import Link from "next/link";
import type { OverviewSection, MeetingSummary, TranscriptSegment } from "@/lib/meeting/types";
import {
	defaultTitleFor,
	isOverviewVisibleKind,
	parseSectionItems,
	type ActionSectionItem,
	type MetricSectionItem,
	type OptionsCompareSectionItem,
	type OverviewSectionKind,
	type QaSectionItem,
	type TextSectionItem,
} from "@/lib/meeting/overviewSections";
import { isGeneratableKind } from "@/lib/meeting/sectionGeneration";
import { useOverviewSectionsEditor } from "../useOverviewSectionsEditor";
import { MeetingOverviewGenerating } from "./MeetingOverviewGenerating";
import { MeetingSummaryCard } from "./MeetingSummaryCard";
import { MeetingActionItemsCard } from "./MeetingActionItemsCard";
import { MeetingDecisionsCard } from "./MeetingDecisionsCard";
import { MeetingBlockersCard } from "./MeetingBlockersCard";
import { MeetingTimelineCard } from "./MeetingTimelineCard";
import { SectionMenu } from "./SectionMenu";
import type { SectionEdit } from "./SectionCardHeader";
import { MeetingAddSectionMenu } from "./MeetingAddSectionMenu";
import { MeetingQuotesCard, MeetingTextListCard } from "./MeetingGenericSectionCards";
import { MeetingMetricsCard, MeetingOptionsCompareCard, MeetingQaCard } from "./MeetingStructuredSectionCards";

/** Renders one dynamic overview section by kind. Every kind in
 *  lib/meeting/overviewSections.ts's OVERVIEW_SECTION_KINDS must have an
 *  entry here — decisions/blockers/actions reuse their pre-existing cards
 *  (look unchanged from before the dynamic-overview feature), everything
 *  else uses one of the generic renderers. Timeline (topics) is NOT a
 *  section kind — it stays the fixed right-column card below. */
function renderSection(section: OverviewSection, makeEdit?: <T>() => SectionEdit<T>) {
	const title = section.title || defaultTitleFor(section.kind);
	switch (section.kind) {
		case "actions":
			return (
				<MeetingActionItemsCard
					key={section.id}
					title={title}
					edit={makeEdit?.()}
					items={parseSectionItems("actions", section.items) as ActionSectionItem[]}
				/>
			);
		case "decisions":
			return (
				<MeetingDecisionsCard
					key={section.id}
					title={title}
					edit={makeEdit?.()}
					decisions={parseSectionItems("decisions", section.items) as TextSectionItem[]}
				/>
			);
		case "blockers":
			return (
				<MeetingBlockersCard
					key={section.id}
					title={title}
					edit={makeEdit?.()}
					blockers={parseSectionItems("blockers", section.items) as TextSectionItem[]}
				/>
			);
		case "risks":
			return (
				<MeetingBlockersCard
					key={section.id}
					title={title}
					edit={makeEdit?.()}
					blockers={parseSectionItems("risks", section.items) as TextSectionItem[]}
				/>
			);
		case "qa":
			return (
				<MeetingQaCard
					key={section.id}
					title={title}
					edit={makeEdit?.()}
					items={parseSectionItems("qa", section.items) as QaSectionItem[]}
				/>
			);
		case "options_compare":
			return (
				<MeetingOptionsCompareCard
					key={section.id}
					title={title}
					edit={makeEdit?.()}
					items={parseSectionItems("options_compare", section.items) as OptionsCompareSectionItem[]}
				/>
			);
		case "metrics":
			return (
				<MeetingMetricsCard
					key={section.id}
					title={title}
					edit={makeEdit?.()}
					items={parseSectionItems("metrics", section.items) as MetricSectionItem[]}
				/>
			);
		case "quotes":
			return (
				<MeetingQuotesCard
					key={section.id}
					title={title}
					edit={makeEdit?.()}
					items={parseSectionItems("quotes", section.items) as TextSectionItem[]}
				/>
			);
		// key_points, open_questions, feedback, custom_text, and any future
		// text-shaped kind fall back to the generic bulleted-list card.
		default:
			return (
				<MeetingTextListCard
					key={section.id}
					title={title}
					edit={makeEdit?.()}
					items={parseSectionItems(section.kind as "key_points", section.items) as TextSectionItem[]}
				/>
			);
	}
}

/**
 * Overview tab body: Summary card, then the meeting's dynamic sections in a
 * responsive grid (1 column on mobile, up to 3 on wide screens — the count
 * of visible columns adapts to how many sections exist, it is not hardcoded
 * to 3 cards any more), and a fixed right-column Timeline card built from
 * `topics` (topics are NOT a section — they stay a separate concept, see
 * MeetingTimelineCard.tsx).
 *
 * Owner-or-editor editing (Step 3 of the dynamic overview feature, widened
 * in Stage C to also allow a shared "editor" grant): rename/reorder/delete
 * a section, edit its items inline, add a new section from the fixed kind
 * library, and edit the prose overview text — all via
 * useOverviewSectionsEditor.ts, which owns the optimistic-update + rollback
 * + error toast plumbing. Viewers (accessRole === "viewer") get the same
 * read-only rendering as before this step.
 */
export function MeetingOverviewTab({
	summary,
	segments,
	meetingId,
	accessRole,
	editingDisabled = false,
	sourceSummary,
	onSummaryChange,
}: {
	summary: MeetingSummary | null;
	/** The untranslated summary the editor works on. Section actions (add,
	 *  generate with AI, move, delete) stay available while a translated view
	 *  is shown; only inline text editing is turned off. */
	sourceSummary?: MeetingSummary | null;
	segments: TranscriptSegment[];
	meetingId: string;
	accessRole: "owner" | "editor" | "viewer";
	/** True while a translated view is shown, so edits never save translated
	 *  text over the source summary. */
	editingDisabled?: boolean;
	/** Threaded down from page.tsx so an edit here updates the single source
	 *  of truth (`detail.summary`) that every other reader (translation
	 *  overlay, download menu, mindmap button) also reads from. */
	onSummaryChange: (updater: (prev: MeetingSummary) => MeetingSummary) => void;
}) {
	const canManage = accessRole === "owner" || accessRole === "editor";
	const canEdit = canManage && !editingDisabled;
	const editor = useOverviewSectionsEditor(meetingId, sourceSummary ?? summary, onSummaryChange);

	if (!summary) return <MeetingOverviewGenerating />;

	const sections = summary.sections.filter((s) => isOverviewVisibleKind(s.kind)).sort((a, b) => a.order - b.order);
	const hasMinutes = summary.sections.some((s) => !isOverviewVisibleKind(s.kind));

	return (
		// pre-line: the bilingual view puts the translation on a new line.
		<div className="grid grid-cols-1 gap-4 whitespace-pre-line lg:grid-cols-3">
			<div className="flex flex-col gap-4 lg:col-span-2">
				<MeetingSummaryCard
					overview={summary.overview}
					onSave={canEdit ? editor.updateOverview : undefined}
					saving={canEdit && editor.savingOverview}
					onRegenerate={canEdit ? () => void editor.regenerateSummary() : undefined}
					regenerating={canEdit && editor.generatingSummary}
				/>
				{hasMinutes && (
					<Link
						href={`/meeting/${meetingId}/minutes`}
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-muted"
					>
						<span>Minutes of Meeting available</span>
						<span className="font-medium">Open ›</span>
					</Link>
				)}
				{sections.length > 0 && (
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
						{sections.map((section, index) => {
							const menu = (
								<SectionMenu
									canMoveUp={index > 0}
									canMoveDown={index < sections.length - 1}
									disabled={editor.savingSectionId === section.id}
									onMove={(direction) => void editor.moveSection(section.id, direction)}
									onDelete={() => void editor.deleteSection(section.id)}
									onGenerate={isGeneratableKind(section.kind) ? () => void editor.generateSection(section.id) : undefined}
									generating={editor.generatingSectionId === section.id}
								/>
							);
							if (canEdit) {
								return renderSection(section, <T,>(): SectionEdit<T> => ({
									onTitleChange: (title) => void editor.renameSection(section.id, title),
									onItemsChange: (items) => void editor.saveItems(section.id, items),
									menu,
								}));
							}
							// Translated view: text stays read-only, the section menu is overlaid.
							return canManage ? (
								<div key={section.id} className="group/card relative flex flex-col [&>*:first-child]:flex-1">
									{renderSection(section)}
									<div className="absolute right-3 top-3 flex">{menu}</div>
								</div>
							) : (
								renderSection(section)
							);
						})}
					</div>
				)}
				{canManage && (
					<MeetingAddSectionMenu onAdd={(kind) => void editor.addSection(kind)} />
				)}
			</div>
			<div className="lg:col-span-1">
				<MeetingTimelineCard
					topics={summary.topics}
					segments={segments}
					onRegenerate={canEdit ? () => void editor.regenerateTimeline() : undefined}
					regenerating={canEdit && editor.generatingTimeline}
				/>
			</div>
		</div>
	);
}
