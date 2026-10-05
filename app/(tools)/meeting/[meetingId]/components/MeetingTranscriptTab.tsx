"use client";

import { useState } from "react";
import { Check, ChevronDown, Copy, FileText, List } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Speaker, SpeakerMapping, TranscriptSegment } from "@/lib/meeting/types";
import { buildSpeakerCopyText } from "@/lib/meeting/buildDownloadText";
import type { TranscriptLanguageMode } from "./MeetingTranslationToggle";
import { MeetingSpeakerRenameList } from "./MeetingSpeakerRenameList";
import { MeetingTranscriptSegmentRow } from "./MeetingTranscriptSegmentRow";
import { MeetingFullScriptView } from "./MeetingFullScriptView";
import { GlossaryQuickAddMenu } from "./GlossaryQuickAddMenu";
import { useGlossaryQuickAdd } from "../useGlossaryQuickAdd";

/**
 * Transcript tab body (spec "Transcript Screen"): per-speaker rows with
 * clickable timestamps that seek the shared sticky audio player (via
 * MeetingAudioSeekContext), an EN/VI/Bilingual display toggle, and inline
 * speaker rename + merge, wired to the real `PUT .../speakers` endpoint.
 *
 * Translation state (target language, translated text, in-flight/error) is
 * owned by the page via useMeetingTranslation.ts — NOT local to this
 * component — because the same "Translate" action also has to update the
 * Overview tab's summary, which this component never renders.
 */
export function MeetingTranscriptTab({
	meetingId,
	segments,
	speakers,
	speakerMappings,
	participantNames,
	languageMode,
	canEdit,
	onSegmentEdit,
}: {
	meetingId: string;
	segments: TranscriptSegment[];
	speakers: Speaker[];
	speakerMappings: SpeakerMapping[];
	participantNames: string[];
	languageMode: TranscriptLanguageMode;
	/** Owner or editor: the original text can be corrected in place. */
	canEdit: boolean;
	onSegmentEdit: (segmentId: string, text: string) => void;
}) {
	// Only the original text is stored editable; translated views stay read-only.
	const editable = canEdit && languageMode === "en";
	const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});
	const [showFullScript, setShowFullScript] = useState(false);
	const [speakerFilter, setSpeakerFilter] = useState<string | null>(null);
	const [copiedAll, setCopiedAll] = useState(false);
	const { menu, handleContextMenu, closeMenu } = useGlossaryQuickAdd();

	const handleRenamed = (speakerKey: string, displayName: string) => {
		setNameOverrides((prev) => ({ ...prev, [speakerKey]: displayName }));
	};

	const resolvedNameFor = (segment: TranscriptSegment) =>
		nameOverrides[segment.speakerKey] ?? segment.speakerDisplayName;
	const visibleSegments = speakerFilter
		? segments.filter((s) => resolvedNameFor(s) === speakerFilter)
		: segments;

	const copyAll = (mode: TranscriptLanguageMode) => {
		const text = buildSpeakerCopyText(segments, mode, resolvedNameFor);
		if (!text) return;
		void navigator.clipboard.writeText(text).then(() => {
			setCopiedAll(true);
			setTimeout(() => setCopiedAll(false), 1500);
		});
	};

	if (segments.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center gap-1 py-16 text-center">
				<p className="text-sm font-medium text-foreground">No transcript yet</p>
				<p className="text-sm text-muted-foreground">
					The transcript will appear here once processing finishes.
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="text-sm font-semibold text-foreground">Raw Transcript</h2>
				<div className="flex items-center gap-2">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								{copiedAll ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
								{copiedAll ? "Copied" : "Copy all by speaker"}
								<ChevronDown className="h-3 w-3" />
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onSelect={() => copyAll("en")}>Original</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => copyAll("vi")}>AI translated</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => copyAll("bilingual")}>Bilingual (original + AI translation)</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<button
						type="button"
						onClick={() => setShowFullScript((v) => !v)}
						className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						{showFullScript ? <List className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
						{showFullScript ? "View by speaker" : "View full script"}
					</button>
				</div>
			</div>

			{canEdit && !editable && (
				<p className="text-xs text-muted-foreground">Switch to Original to correct the transcript text.</p>
			)}

			{/* Selecting text and right-clicking anywhere in this area opens a
			    quick "add to glossary" popover instead of the browser's default
			    menu — see useGlossaryQuickAdd.ts. */}
			<div onContextMenu={handleContextMenu}>
				{showFullScript ? (
					<MeetingFullScriptView segments={segments} languageMode={languageMode} onSegmentEdit={editable ? onSegmentEdit : undefined} />
				) : (
					<>
						<MeetingSpeakerRenameList
							meetingId={meetingId}
							speakers={speakers}
							speakerMappings={speakerMappings}
							participantNames={participantNames}
							segments={segments}
							nameOverrides={nameOverrides}
							onRenamed={handleRenamed}
							activeFilter={speakerFilter}
							onFilterChange={setSpeakerFilter}
						/>

						<div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
							{visibleSegments.map((segment) => (
								<MeetingTranscriptSegmentRow
									key={segment.id}
									segment={segment}
									languageMode={languageMode}
									displayName={resolvedNameFor(segment)}
									onTextEdit={editable ? (text) => onSegmentEdit(segment.id, text) : undefined}
								/>
							))}
						</div>
					</>
				)}
			</div>

			{menu && <GlossaryQuickAddMenu state={menu} onClose={closeMenu} />}
		</div>
	);
}
