"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Download, FileText, Loader2, MoreHorizontal, Pencil, Share2, Workflow } from "lucide-react";
import { toast } from "sonner";
import { formatDateLabel, formatDurationSec } from "@/lib/meeting/format";
import { emitMeetingRenamed } from "@/lib/meeting/meetingEvents";
import type { MeetingSummary, TranscriptSegment } from "@/lib/meeting/types";
import type { AudioExpiryInfo } from "@/lib/meeting/audioRetention";
import { createWorkspaceBoardEntry } from "@/app/workspace/hooks/workspaceBoardIndex";
import { MeetingDownloadMenu } from "./MeetingDownloadMenu";
import { MeetingShareDialog } from "./MeetingShareDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { AskAnswer } from "./MeetingAskAnswerCard";

/**
 * Title + metadata line ("date · duration · N speakers") and a single top-right
 * "…" menu (Minutes, mindmap, Download, Share). Route navigation stays in the
 * shared shell, so the header only owns the meeting-specific controls.
 *
 * The title is click-to-edit: PATCH /api/meeting/[meetingId] (rename-only,
 * everything else on a meeting comes from the recording/AI pipeline), then
 * emitMeetingRenamed() so the sidebar's Recent list (MeetingAside.tsx)
 * updates in place instead of waiting for a fetch that may never re-run
 * while staying on this same page.
 */
export function MeetingResultHeader({
	meetingId,
	title,
	createdAt,
	durationSec,
	speakerCount,
	audioUrl,
	segments,
	summary,
	askAnswers,
	audioExpiry,
	mindmapBoardId,
	onRenamed,
	accessRole,
	translationControl,
}: {
	meetingId: string;
	title: string;
	createdAt: string;
	durationSec: number | null;
	speakerCount: number;
	audioUrl: string | null;
	segments: TranscriptSegment[];
	summary: MeetingSummary | null;
	askAnswers: AskAnswer[];
	audioExpiry: AudioExpiryInfo | null;
	/** The WorkspaceBoard already generated for this meeting, if any (see
	 *  Meeting.mindmapBoardId) — swaps the button to "View mindmap" instead
	 *  of "Create mindmap" so it links straight back instead of only working
	 *  for the tab that was open right when it was first created. */
	mindmapBoardId: string | null;
	onRenamed: (title: string) => void;
	accessRole: "owner" | "editor" | "viewer";
	/** Original / translated / bilingual switch, shown next to the "…" menu. */
	translationControl?: ReactNode;
}) {
	const isOwner = accessRole === "owner";
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(title);
	const [saving, setSaving] = useState(false);
	const [creatingMindmap, setCreatingMindmap] = useState(false);
	const [boardId, setBoardId] = useState(mindmapBoardId);
	const [downloadOpen, setDownloadOpen] = useState(false);
	const [shareOpen, setShareOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	// Resyncs when the sidebar switches to a different meeting (this
	// component isn't remounted on that navigation, only its props change).
	useEffect(() => setBoardId(mindmapBoardId), [meetingId, mindmapBoardId]);

	const openMindmap = async () => {
		setCreatingMindmap(true);
		// Opened synchronously, still inside this click's user-gesture window —
		// popup blockers allow window.open() called directly from an event
		// handler, but not one called after an `await` (the fetch below), which
		// is what silently ate this tab before. Navigating this already-open
		// handle once the board exists is not a *new* popup, so it's exempt.
		const pendingTab = window.open("", "_blank");
		try {
			// POSTs even when `boardId` is already known — the route is
			// idempotent per meeting (returns the existing board instead of
			// generating a new one), and re-checking here is what catches a
			// board that was deleted out from under this meeting.
			const res = await fetch(`/api/meeting/${meetingId}/mindmap`, { method: "POST" });
			const data = (await res.json().catch(() => null)) as { boardId?: string; title?: string; error?: string } | null;
			if (!res.ok || !data?.boardId) {
				pendingTab?.close();
				toast.error(data?.error || "Could not create mindmap from this meeting");
				return;
			}
			setBoardId(data.boardId);
			createWorkspaceBoardEntry(data.boardId, data.title || title);
			const url = `/workspace?id=${data.boardId}`;
			if (pendingTab) {
				pendingTab.location.href = url;
			} else {
				// The synchronous open above was blocked too (e.g. a stricter
				// popup setting) — fall back to a toast the user can click, so
				// the mindmap is never out of reach.
				toast.success("Mindmap ready", { action: { label: "Open mindmap", onClick: () => window.open(url, "_blank") } });
			}
		} catch {
			pendingTab?.close();
			toast.error("Could not open the mindmap for this meeting");
		} finally {
			setCreatingMindmap(false);
		}
	};

	const startEditing = () => {
		setDraft(title);
		setEditing(true);
		requestAnimationFrame(() => inputRef.current?.select());
	};

	const commit = async () => {
		const next = draft.trim();
		if (!next || next === title) {
			setEditing(false);
			return;
		}
		setSaving(true);
		try {
			const res = await fetch(`/api/meeting/${meetingId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: next }),
			});
			if (res.ok) {
				onRenamed(next);
				emitMeetingRenamed(meetingId, next);
			}
		} finally {
			setSaving(false);
			setEditing(false);
		}
	};

	return (
		<div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-6">
			<div className="min-w-0 flex-1">
				{!isOwner ? (
					<h1 className="break-words text-lg font-semibold text-foreground" title={title}>{title}</h1>
				) : editing ? (
					<input
						ref={inputRef}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onBlur={commit}
						onKeyDown={(e) => {
							if (e.key === "Enter") { e.preventDefault(); commit(); }
							if (e.key === "Escape") { setDraft(title); setEditing(false); }
						}}
						disabled={saving}
						autoFocus
						className="w-full rounded-md border border-border bg-background px-1.5 py-0.5 text-lg font-semibold text-foreground outline-none"
					/>
				) : (
					<button
						type="button"
						onClick={startEditing}
						className="group/title flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 text-left hover:bg-muted"
						title={title}
					>
						<h1 className="min-w-0 break-words text-lg font-semibold text-foreground">{title}</h1>
						{saving ? (
							<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
						) : (
							<Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover/title:opacity-100" />
						)}
					</button>
				)}
				<p className="mt-1 text-sm text-muted-foreground">
					{formatDateLabel(createdAt)} · {formatDurationSec(durationSec)} ·{" "}
					{speakerCount} speaker{speakerCount === 1 ? "" : "s"}
				</p>
			</div>

			<div className="flex flex-wrap items-center justify-end gap-2">
				{translationControl}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							aria-label="More options"
							title="More options"
							className="rounded-md border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:bg-muted"
						>
							{creatingMindmap ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-48">
						<DropdownMenuItem asChild>
							<Link href={`/meeting/${meetingId}/minutes`} target="_blank" rel="noopener noreferrer">
								<FileText className="mr-2 h-3.5 w-3.5" /> Minutes
							</Link>
						</DropdownMenuItem>
						{isOwner && summary && (
							<DropdownMenuItem disabled={creatingMindmap} onSelect={() => void openMindmap()}>
								<Workflow className="mr-2 h-3.5 w-3.5" /> {boardId ? "View mindmap" : "Create mindmap"}
							</DropdownMenuItem>
						)}
						<DropdownMenuItem onSelect={() => setDownloadOpen(true)}>
							<Download className="mr-2 h-3.5 w-3.5" /> Download
						</DropdownMenuItem>
						{isOwner && (
							<DropdownMenuItem onSelect={() => setShareOpen(true)}>
								<Share2 className="mr-2 h-3.5 w-3.5" /> Share
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
				<MeetingDownloadMenu
					open={downloadOpen}
					onOpenChange={setDownloadOpen}
					title={title}
					audioUrl={audioUrl}
					segments={segments}
					summary={summary}
					askAnswers={askAnswers}
					audioExpiry={audioExpiry}
				/>
				{isOwner && <MeetingShareDialog meetingId={meetingId} open={shareOpen} onOpenChange={setShareOpen} />}
			</div>
		</div>
	);
}
