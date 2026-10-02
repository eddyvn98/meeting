"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { FileText, Loader2, MoreHorizontal, Pencil, Share2, Trash2 } from "lucide-react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Meeting, MeetingGroup } from "@/lib/meeting/types";
import { emitMeetingRenamed } from "@/lib/meeting/meetingEvents";
import { computeAudioExpiry } from "@/lib/meeting/audioRetention";
import { AudioCountdownIcon } from "./AudioCountdownIcon";

/**
 * One row in the sidebar's Recent list (MeetingAside.tsx): title link and a
 * "..." menu (rename, move to group, delete). Delete asks for confirmation in
 * a dialog first, then calls DELETE /api/meeting/[meetingId] (already
 * existed server-side — app/api/meeting/[meetingId]/route.ts — this was
 * just never wired up in the UI) and reports success so the parent can drop
 * it from the list.
 *
 * Rename calls the same PATCH /api/meeting/[meetingId] endpoint as the
 * result page's title (MeetingResultHeader.tsx), then emitMeetingRenamed()
 * so the currently-open meeting page picks it up immediately if this row
 * happens to be the active one — the reverse direction of the sync
 * MeetingAside.tsx already sets up for renames made on the result page.
 *
 * `meeting.isShared` (set by GET /api/meeting) shows a small share icon —
 * covers both "I shared this out" and "someone shared this with me".
 * `meeting.sharedWithMe` specifically means the latter, which also means
 * this row's viewer definitely isn't the owner, so the rename/delete
 * buttons (owner-only actions server-side anyway) are hidden rather than
 * left to fail.
 *
 * `retentionDays` (from useAudioRetentionDays, GET /api/meeting/storage-info)
 * swaps the leading document icon for an AudioCountdownIcon whenever this
 * meeting has an audio file subject to the scheduled cleanup sweep
 * (cleanupMeetingAudio.ts) — a small ring showing days left, ticking down
 * once a day, turning amber/red as the sweep gets close/has run (see
 * lib/meeting/audioRetention.ts). Falls back to the plain document icon
 * when there's nothing to count down (still processing, no audio, or
 * `retentionDays` hasn't loaded yet).
 */
export function MeetingAsideRecentItem({
	meeting,
	isActive,
	onDeleted,
	retentionDays,
	groups,
	onMoved,
}: {
	meeting: Meeting;
	isActive: boolean;
	onDeleted: (id: string) => void;
	/** null while GET /api/meeting/storage-info is still loading — the
	 *  expiry warning below just stays hidden until it resolves. */
	retentionDays: number | null;
	/** The caller's sidebar folders (MeetingAside.tsx) — powers the "Move to
	 *  group" select below. Omitted (or empty) hides that control entirely,
	 *  e.g. nothing to move into yet. */
	groups?: MeetingGroup[];
	/** Called after a successful move (including moving back to "No group")
	 *  so the parent can update this meeting's groupId locally instead of
	 *  refetching the whole list. */
	onMoved?: (meetingId: string, groupId: string | null) => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(meeting.title);
	const [saving, setSaving] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const startEditing = () => {
		setDraft(meeting.title);
		setEditing(true);
		requestAnimationFrame(() => inputRef.current?.select());
	};

	const commitRename = async () => {
		const next = draft.trim();
		if (!next || next === meeting.title) {
			setEditing(false);
			return;
		}
		setSaving(true);
		try {
			const res = await fetch(`/api/meeting/${meeting.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: next }),
			});
			if (res.ok) emitMeetingRenamed(meeting.id, next);
		} finally {
			setSaving(false);
			setEditing(false);
		}
	};

	const handleDelete = async () => {
		if (deleting) return;
		setDeleting(true);
		try {
			const res = await fetch(`/api/meeting/${meeting.id}`, { method: "DELETE" });
			if (res.ok) onDeleted(meeting.id);
		} finally {
			setDeleting(false);
			setConfirming(false);
		}
	};

	if (editing) {
		return (
			<li className="flex items-center gap-1.5 rounded-md px-2 py-1.5">
				<FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				<input
					ref={inputRef}
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={commitRename}
					onKeyDown={(e) => {
						if (e.key === "Enter") { e.preventDefault(); commitRename(); }
						if (e.key === "Escape") { setDraft(meeting.title); setEditing(false); }
					}}
					disabled={saving}
					autoFocus
					className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5 text-xs text-foreground outline-none"
				/>
				{saving && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
			</li>
		);
	}

	const expiry = retentionDays !== null ? computeAudioExpiry(meeting, retentionDays) : null;

	return (
		<li
			className={`group/item relative flex items-center rounded-md px-2 py-1.5 text-xs transition-colors ${
				isActive
					? "bg-sidebar-accent font-semibold text-primary"
					: "text-muted-foreground hover:bg-sidebar-hover hover:text-foreground dark:hover:bg-slate-800"
			}`}
		>
			<Link
				href={meeting.status === "READY" ? `/meeting/${meeting.id}` : `/meeting/${meeting.id}/processing`}
				className="flex min-w-0 flex-1 items-center gap-2"
			>
				{expiry && retentionDays !== null ? (
					<AudioCountdownIcon expiry={expiry} retentionDays={retentionDays} />
				) : (
					<FileText className="h-3.5 w-3.5 shrink-0" />
				)}
				<span className="min-w-0 flex-1 truncate" title={meeting.title}>
					{meeting.title}
				</span>
				{meeting.isShared && (
					<span title={meeting.sharedWithMe ? "Shared with you" : "Shared"} className="inline-flex shrink-0">
						<Share2 className="h-3 w-3 text-muted-foreground" />
					</span>
				)}
			</Link>
			{!meeting.sharedWithMe && (
				<>
					{/* Zero-width until the row is hovered/focused or the menu is open, so
					    revealing "..." squeezes the title instead of covering the share icon. */}
					<div
						className={`flex shrink-0 items-center overflow-hidden transition-[width] ${
							menuOpen || deleting ? "w-6" : "w-0 focus-within:w-6 group-hover/item:w-6 [@media(hover:none)]:w-6"
						}`}
					>
						<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									aria-label="Meeting actions"
									title="Meeting actions"
									className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
								>
									{deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-44" onCloseAutoFocus={(e) => e.preventDefault()}>
								<DropdownMenuItem onSelect={startEditing}>
									<Pencil className="mr-2 h-3.5 w-3.5" /> Rename
								</DropdownMenuItem>
								{groups && (
									<DropdownMenuSub>
										<DropdownMenuSubTrigger>Move to group</DropdownMenuSubTrigger>
										<DropdownMenuSubContent>
											{groups.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No groups yet — create one first.</div>}
											<DropdownMenuRadioGroup
												value={meeting.groupId ?? ""}
												onValueChange={async (value) => {
													const groupId = value || null;
													const res = await fetch(`/api/meeting/${meeting.id}`, {
														method: "PATCH",
														headers: { "Content-Type": "application/json" },
														body: JSON.stringify({ groupId }),
													});
													if (res.ok) onMoved?.(meeting.id, groupId);
												}}
											>
												<DropdownMenuRadioItem value="">No group</DropdownMenuRadioItem>
												{groups.map((g) => (
													<DropdownMenuRadioItem key={g.id} value={g.id}>
														{g.name}
													</DropdownMenuRadioItem>
												))}
											</DropdownMenuRadioGroup>
										</DropdownMenuSubContent>
									</DropdownMenuSub>
								)}
								<DropdownMenuSeparator />
								<DropdownMenuItem onSelect={() => setConfirming(true)} className="text-red-600 focus:text-red-600">
									<Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
					<AlertDialog open={confirming} onOpenChange={setConfirming}>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Delete this meeting?</AlertDialogTitle>
								<AlertDialogDescription>&ldquo;{meeting.title}&rdquo; and its transcript, summary and minutes will be permanently deleted.</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</>
			)}
		</li>
	);
}
