"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Folder, Loader2, MessageCircleQuestion, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Meeting, MeetingGroup } from "@/lib/meeting/types";
import { MeetingAsideRecentItem } from "./MeetingAsideRecentItem";

/**
 * One sidebar folder section (MeetingAsideGroupList.tsx): an expandable
 * header (name, meeting count, and a "..." menu with rename, delete and a link
 * to the group's "Ask across this group" page) plus its own meetings rendered as normal
 * MeetingAsideRecentItem rows so rename/delete/move-to-group still work
 * from inside a folder, not just the plain Recent list.
 *
 * Deleting a group never deletes its meetings — the DELETE endpoint's
 * onDelete: SetNull un-files them server-side; `onMeetingMoved(id, null)` is
 * called for each one here so the sidebar reflects that immediately instead
 * of waiting for a refetch.
 */
export function MeetingAsideGroupSection({
	group,
	meetings,
	activeMeetingId,
	retentionDays,
	groups,
	onMeetingMoved,
	onMeetingDeleted,
	onRename,
	onDelete,
}: {
	group: MeetingGroup;
	meetings: Meeting[];
	activeMeetingId?: string;
	retentionDays: number | null;
	groups: MeetingGroup[];
	onMeetingMoved: (meetingId: string, groupId: string | null) => void;
	onMeetingDeleted: (id: string) => void;
	/** Renames the group server-side and patches the shared groups list —
	 *  see useMeetingGroups.ts. */
	onRename: (groupId: string, name: string) => Promise<void>;
	/** Deletes the group server-side and patches the shared groups list,
	 *  resolving to whether it actually succeeded. */
	onDelete: (groupId: string) => Promise<boolean>;
}) {
	const [expanded, setExpanded] = useState(true);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(group.name);
	const [confirming, setConfirming] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [busy, setBusy] = useState(false);

	const commitRename = async () => {
		const name = draft.trim();
		setEditing(false);
		if (!name || name === group.name) return;
		await onRename(group.id, name);
	};

	const handleDelete = async () => {
		if (busy) return;
		setBusy(true);
		try {
			const ok = await onDelete(group.id);
			if (ok) {
				for (const m of meetings) onMeetingMoved(m.id, null);
			}
		} finally {
			setBusy(false);
			setConfirming(false);
		}
	};

	return (
		<li className="flex flex-col gap-0.5">
			<div className="group/group flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-hover dark:hover:bg-slate-800">
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
				>
					{expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
					<Folder className="h-3.5 w-3.5 shrink-0" />
					{editing ? (
						<input
							autoFocus
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							onBlur={commitRename}
							onClick={(e) => e.stopPropagation()}
							onKeyDown={(e) => {
								if (e.key === "Enter") { e.preventDefault(); commitRename(); }
								if (e.key === "Escape") { setDraft(group.name); setEditing(false); }
							}}
							className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5 text-xs text-foreground outline-none"
						/>
					) : (
						<span className="min-w-0 flex-1 truncate font-medium text-foreground" title={group.name}>
							{group.name}
						</span>
					)}
					<span className="shrink-0 text-[10px]">{meetings.length}</span>
				</button>
				{/* Zero-width until hovered/focused or the menu is open (always shown on
				    touch screens, which have no hover), so it never covers the name. */}
				<div
					className={`flex shrink-0 items-center overflow-hidden transition-[width] ${
						menuOpen || busy ? "w-5" : "w-0 focus-within:w-5 group-hover/group:w-5 [@media(hover:none)]:w-5"
					}`}
				>
					<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								aria-label="Group actions"
								title="Group actions"
								className="flex h-5 w-5 items-center justify-center rounded hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
							>
								{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-48" onCloseAutoFocus={(e) => e.preventDefault()}>
							<DropdownMenuItem asChild>
								<Link href={`/meeting/group/${group.id}`}>
									<MessageCircleQuestion className="mr-2 h-3.5 w-3.5" /> Ask across this group
								</Link>
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => { setDraft(group.name); setEditing(true); }}>
								<Pencil className="mr-2 h-3.5 w-3.5" /> Rename
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={() => setConfirming(true)} className="text-red-600 focus:text-red-600">
								<Trash2 className="mr-2 h-3.5 w-3.5" /> Delete group
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
				<AlertDialog open={confirming} onOpenChange={setConfirming}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Delete this group?</AlertDialogTitle>
							<AlertDialogDescription>
								&ldquo;{group.name}&rdquo; will be deleted. Its meetings are not deleted — they just move out of the group.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction onClick={handleDelete}>Delete group</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
			{expanded && meetings.length > 0 && (
				<ul className="ml-4 flex flex-col gap-0.5 border-l border-border pl-2">
					{meetings.map((meeting) => (
						<MeetingAsideRecentItem
							key={meeting.id}
							meeting={meeting}
							isActive={meeting.id === activeMeetingId}
							onDeleted={onMeetingDeleted}
							retentionDays={retentionDays}
							groups={groups}
							onMoved={onMeetingMoved}
						/>
					))}
				</ul>
			)}
		</li>
	);
}
