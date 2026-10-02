"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { avatarPaletteFor, formatClock, initialsOf } from "@/lib/meeting/format";
import type { TranscriptSegment } from "@/lib/meeting/types";
import type { TranscriptLanguageMode } from "./MeetingTranslationToggle";
import { InlineText } from "./InlineText";
import { useMeetingAudioSeek, useIsPlaybackActive } from "./MeetingAudioSeekContext";

function primaryTextFor(segment: TranscriptSegment, mode: TranscriptLanguageMode): string | null {
	if (mode === "vi") return segment.textVi;
	return segment.textEn;
}

/**
 * One speaker turn: "Speaker N  18:24" header (per spec section on the
 * Transcript screen) + the utterance text below. The timestamp is a button
 * that requests an audio seek via MeetingAudioSeekContext. Bilingual mode
 * stacks the Vietnamese line under the English one when both exist. A copy
 * button lets a single utterance be grabbed without a manual select-drag
 * (selecting text here and right-clicking instead opens the "add to
 * glossary" popover — see useGlossaryQuickAdd.ts).
 *
 * Highlights itself (orange left border + tinted background) while the
 * shared player's position is within [startTimeMs, endTimeMs) — karaoke-
 * style follow-along — and scrolls itself into view the moment it becomes
 * the active row, so playback from the transcript (or just letting it run)
 * keeps the current line visible without the reader hunting for it.
 */
export function MeetingTranscriptSegmentRow({
	segment,
	languageMode,
	displayName,
	onTextEdit,
}: {
	segment: TranscriptSegment;
	languageMode: TranscriptLanguageMode;
	displayName: string;
	/** Given only when the original text may be corrected in place. */
	onTextEdit?: (text: string) => void;
}) {
	const { seekTo, seekRequest } = useMeetingAudioSeek();
	const isActive = useIsPlaybackActive(segment.startTimeMs, segment.endTimeMs);
	const [copied, setCopied] = useState(false);
	const rowRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!isActive) return;
		// A no-scroll seek (the Speakers panel's sample preview) suppresses
		// auto-follow for the WHOLE playback session it started, not just the
		// segment it targeted — playback keeps running past a short sample
		// into later segments, and each of those becoming active must stay
		// silent too, or the page still jumps once the sample segment ends.
		// A normal seek (autoScroll left at its true default) re-enables
		// follow-along again.
		if (seekRequest?.autoScroll === false) return;
		rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}, [isActive, seekRequest]);

	const primaryText = primaryTextFor(segment, languageMode === "bilingual" ? "en" : languageMode);
	const showSecondary = languageMode === "bilingual";

	const copyText = () => {
		const combined = [primaryText, showSecondary ? segment.textVi : null].filter(Boolean).join("\n");
		if (!combined) return;
		void navigator.clipboard.writeText(combined).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	};

	return (
		<div
			ref={rowRef}
			className={`group flex gap-3 border-l-2 px-4 py-3 transition-colors ${
				isActive ? "border-primary bg-primary-light/40 dark:bg-amber-950/20" : "border-transparent"
			}`}
		>
			<span
				className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${avatarPaletteFor(segment.speakerKey)}`}
			>
				{initialsOf(displayName)}
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline gap-2">
					<span className="text-sm font-semibold text-foreground">{displayName}</span>
					<button
						type="button"
						onClick={() => seekTo(segment.startTimeMs)}
						className="text-xs font-medium text-primary hover:underline"
					>
						{formatClock(segment.startTimeMs)}
					</button>
					<button
						type="button"
						onClick={copyText}
						disabled={!primaryText}
						aria-label="Copy this line"
						title="Copy this line"
						className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 disabled:cursor-not-allowed"
					>
						{copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
					</button>
				</div>

				{onTextEdit && primaryText ? (
					<div className="mt-0.5 text-sm text-foreground">
						<InlineText value={primaryText} ariaLabel="Transcript text" onCommit={(text) => text.trim() && onTextEdit(text.trim())} />
					</div>
				) : primaryText ? (
					<p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{primaryText}</p>
				) : (
					<p className="mt-0.5 text-sm italic text-muted-foreground">
						AI translation not available yet.
					</p>
				)}

				{showSecondary &&
					(segment.textVi ? (
						<p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
							<span className="mr-1 text-[11px] font-medium uppercase tracking-wide opacity-70">AI</span>
							{segment.textVi}
						</p>
					) : (
						<p className="mt-0.5 text-sm italic text-muted-foreground">
							AI translation not available yet.
						</p>
					))}
			</div>
		</div>
	);
}
