"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { TranscriptSegment } from "@/lib/meeting/types";
import type { TranscriptLanguageMode } from "./MeetingTranslationToggle";

/** One segment inside the flowing script, editable in place. Saves on blur when
 *  the text changed; Escape reverts. Plain text only. */
function EditableScriptSpan({ text, onCommit }: { text: string; onCommit: (text: string) => void }) {
	return (
		<span
			contentEditable
			suppressContentEditableWarning
			spellCheck={false}
			role="textbox"
			aria-label="Transcript text"
			className="rounded outline-none hover:bg-muted/60 focus:bg-muted/60"
			onBlur={(e) => {
				const next = (e.currentTarget.textContent ?? "").trim();
				if (next && next !== text) onCommit(next);
				else e.currentTarget.textContent = text;
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.currentTarget.textContent = text;
					e.currentTarget.blur();
				}
			}}
			onPaste={(e) => {
				e.preventDefault();
				document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
			}}
		>
			{text}
		</span>
	);
}

/**
 * "View full script" mode for the Transcript tab: every segment's text
 * joined into one plain, continuously-readable block — no per-speaker rows,
 * no per-line timestamp breaks — so the whole recording can be selected and
 * copied in one go instead of one utterance at a time. Segment boundaries
 * (mergeUtterances.ts already groups raw STT chunks into natural utterances)
 * still exist in the data but are intentionally invisible here.
 */
export function MeetingFullScriptView({
	segments,
	languageMode,
	onSegmentEdit,
}: {
	segments: TranscriptSegment[];
	languageMode: TranscriptLanguageMode;
	/** Given only when the original text may be corrected in place. */
	onSegmentEdit?: (segmentId: string, text: string) => void;
}) {
	const [copied, setCopied] = useState(false);
	const showBoth = languageMode === "bilingual";
	const text = (mode: "en" | "vi") =>
		segments
			.map((s) => (mode === "vi" ? s.textVi : s.textEn))
			.filter((t): t is string => Boolean(t && t.trim()))
			.join(" ");

	const primary = text(languageMode === "vi" ? "vi" : "en");
	const secondary = showBoth ? text("vi") : null;

	const copyAll = () => {
		const combined = [primary, secondary].filter(Boolean).join("\n\n");
		void navigator.clipboard.writeText(combined).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	};

	return (
		<div className="rounded-xl border border-border bg-card p-4">
			<div className="mb-2 flex justify-end">
				<button
					type="button"
					onClick={copyAll}
					disabled={!primary && !secondary}
					className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
				>
					{copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
			{onSegmentEdit && primary ? (
				<p className="select-text whitespace-pre-wrap text-sm leading-relaxed text-foreground">
					{segments
						.filter((s) => s.textEn && s.textEn.trim())
						.map((s, index) => (
							<span key={s.id}>
								{index > 0 && " "}
								<EditableScriptSpan text={s.textEn as string} onCommit={(text) => onSegmentEdit(s.id, text)} />
							</span>
						))}
				</p>
			) : (
				<p className="select-text whitespace-pre-wrap text-sm leading-relaxed text-foreground">
					{primary || "No transcript text available."}
				</p>
			)}
			{showBoth && (
				<>
					<div className="my-3 border-t border-border" />
					<p className="select-text whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
						{secondary ? <><span className="mr-1 text-[11px] font-medium uppercase tracking-wide opacity-70">AI</span>{secondary}</> : "AI translation not available yet."}
					</p>
				</>
			)}
		</div>
	);
}
