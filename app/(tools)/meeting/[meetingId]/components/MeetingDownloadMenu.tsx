"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Download } from "lucide-react";
import type { MeetingSummary, TranscriptSegment } from "@/lib/meeting/types";
import type { AudioExpiryInfo } from "@/lib/meeting/audioRetention";
import {
	buildFullPackageText,
	buildRawTranscriptText,
	buildSpeakerScriptText,
} from "@/lib/meeting/buildDownloadText";
import type { AskAnswer } from "./MeetingAskAnswerCard";
import { AudioExpiryNote } from "./AudioExpiryNote";

interface DownloadOption {
	key: "audio" | "raw" | "speaker" | "full";
	label: string;
}

const OPTIONS: DownloadOption[] = [
	{ key: "audio", label: "Recording audio file" },
	{ key: "raw", label: "Raw transcript (plain text)" },
	{ key: "speaker", label: "Transcript by speaker (timestamped)" },
	{ key: "full", label: "Full package — transcript + summary + Ask AI conversation" },
];

function downloadTextFile(filename: string, content: string) {
	const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

/**
 * "Download" button + popover in the Meeting Result header: pick any
 * combination of the audio file, a plain-text transcript, a speaker-
 * timestamped script, or a full package (transcript + AI summary + this
 * session's Ask AI conversation — that conversation only lives in
 * MeetingAskTab's client state, reported up via onAskHistoryChange in
 * page.tsx, since it's never persisted server-side). Audio downloads as the
 * real file via the existing streaming endpoint; the text options are
 * combined into one .txt file so the user isn't hit with several separate
 * downloads for what is conceptually one export.
 */
export function MeetingDownloadMenu({
	title,
	audioUrl,
	segments,
	summary,
	askAnswers,
	audioExpiry,
	open: controlledOpen,
	onOpenChange,
}: {
	/** Controlled mode: shows the panel as a dialog with no trigger button, so
	 *  a parent menu can open it. Omit for the self-contained button + popover. */
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	title: string;
	audioUrl: string | null;
	segments: TranscriptSegment[];
	summary: MeetingSummary | null;
	askAnswers: AskAnswer[];
	/** Drives the countdown under the "Recording audio file" option — see
	 *  lib/meeting/audioRetention.ts. null when the meeting has no audio or is
	 *  still processing. */
	audioExpiry: AudioExpiryInfo | null;
}) {
	const controlled = controlledOpen !== undefined;
	const [innerOpen, setInnerOpen] = useState(false);
	const open = controlled ? controlledOpen : innerOpen;
	const setOpen = (value: boolean | ((prev: boolean) => boolean)) => {
		const next = typeof value === "function" ? value(open) : value;
		if (controlled) onOpenChange?.(next);
		else setInnerOpen(next);
	};	const [selected, setSelected] = useState<Set<DownloadOption["key"]>>(new Set(["speaker"]));

	const toggle = (key: DownloadOption["key"]) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	const safeTitle = title.replace(/[\\/:*?"<>|]+/g, "_").trim() || "meeting";

	const handleDownload = () => {
		if (selected.has("audio") && audioUrl) {
			const a = document.createElement("a");
			a.href = audioUrl;
			a.download = `${safeTitle}-audio`;
			document.body.appendChild(a);
			a.click();
			a.remove();
		}

		if (selected.has("full")) {
			downloadTextFile(
				`${safeTitle}-full.txt`,
				buildFullPackageText({ title, segments, summary, askAnswers }),
			);
		} else {
			const parts: string[] = [];
			if (selected.has("raw")) parts.push("=== Raw Transcript ===", buildRawTranscriptText(segments));
			if (selected.has("speaker")) parts.push("=== Transcript (by speaker) ===", buildSpeakerScriptText(segments));
			if (parts.length > 0) downloadTextFile(`${safeTitle}-transcript.txt`, parts.join("\n\n"));
		}

		setOpen(false);
	};

	const panel = (
					<div className={controlled ? "" : "absolute right-0 top-full z-20 mt-1.5 w-72 rounded-lg border border-border bg-card p-3 shadow-lg"}>
						<p className="mb-2 text-xs font-medium text-muted-foreground">Choose what to download</p>
						<div className="flex flex-col gap-1.5">
							{OPTIONS.map((opt) => (
								<label key={opt.key} className="flex items-start gap-2 text-sm text-foreground">
									<input
										type="checkbox"
										checked={selected.has(opt.key)}
										onChange={() => toggle(opt.key)}
										disabled={opt.key === "audio" && !audioUrl}
										className="mt-0.5 h-3.5 w-3.5 accent-brand-orange"
									/>
									<span className={opt.key === "audio" && !audioUrl ? "text-muted-foreground" : ""}>
										{opt.label}
										{opt.key === "audio" && !audioUrl && " (no audio file)"}
										{opt.key === "audio" && audioUrl && audioExpiry && (
											<span className="mt-0.5 block">
												<AudioExpiryNote expiry={audioExpiry} />
											</span>
										)}
									</span>
								</label>
							))}
						</div>
						<button
							type="button"
							onClick={handleDownload}
							disabled={selected.size === 0}
							className="mt-3 w-full rounded-md bg-brand-orange px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
						>
							Download
						</button>
					</div>
	);

	if (controlled) {
		return (
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-sm">
					<DialogTitle className="sr-only">Download</DialogTitle>
					{panel}
				</DialogContent>
			</Dialog>
		);
	}

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-label="Download"
				aria-expanded={open}
				className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
			>
				<Download className="h-3.5 w-3.5" />
				Download
			</button>

			{open && (
				<>
					<div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
					{panel}
				</>
			)}
		</div>
	);
}
