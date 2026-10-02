"use client";

import { useState } from "react";
import { FolderPlus } from "lucide-react";
import type { Meeting, MeetingGroup } from "@/lib/meeting/types";
import { MeetingAsideGroupSection } from "./MeetingAsideGroupSection";

/**
 * Sidebar "Groups" section (MeetingAside.tsx): renders the caller's sidebar
 * folders (from useMeetingGroups, owned by the parent so the plain Recent
 * list's rows can also offer the same "Move to group" options) plus a "New
 * group" control. Meeting membership/move/delete still flow up to the
 * parent via `meetings` + the two meeting callbacks, since that's the same
 * allMeetings state the plain (ungrouped) Recent list is derived from.
 */
export function MeetingAsideGroupList({
	groups,
	onCreate,
	onRename,
	onDelete,
	meetings,
	activeMeetingId,
	retentionDays,
	onMeetingMoved,
	onMeetingDeleted,
}: {
	groups: MeetingGroup[];
	onCreate: (name: string) => void;
	onRename: (groupId: string, name: string) => Promise<void>;
	onDelete: (groupId: string) => Promise<boolean>;
	/** Full unfiltered meetings list (MeetingAside.tsx's allMeetings) — this
	 *  component filters down to each group's own members itself. */
	meetings: Meeting[];
	activeMeetingId?: string;
	retentionDays: number | null;
	onMeetingMoved: (meetingId: string, groupId: string | null) => void;
	onMeetingDeleted: (id: string) => void;
}) {
	const [creating, setCreating] = useState(false);
	const [draft, setDraft] = useState("");

	const submitCreate = () => {
		const name = draft.trim();
		setDraft("");
		setCreating(false);
		if (name) onCreate(name);
	};

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center justify-between px-2">
				<p className="text-xs font-medium text-muted-foreground">Groups</p>
				<button
					type="button"
					onClick={() => setCreating(true)}
					aria-label="New group"
					title="New group"
					className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-hover hover:text-foreground dark:hover:bg-slate-800"
				>
					<FolderPlus className="h-3.5 w-3.5" />
				</button>
			</div>
			{creating && (
				<input
					autoFocus
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={submitCreate}
					onKeyDown={(e) => {
						if (e.key === "Enter") { e.preventDefault(); submitCreate(); }
						if (e.key === "Escape") { setDraft(""); setCreating(false); }
					}}
					placeholder="Group name…"
					className="mx-2 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
				/>
			)}
			{groups.length > 0 && (
				<ul className="flex flex-col gap-0.5">
					{groups.map((group) => (
						<MeetingAsideGroupSection
							key={group.id}
							group={group}
							meetings={meetings.filter((m) => m.groupId === group.id)}
							activeMeetingId={activeMeetingId}
							retentionDays={retentionDays}
							groups={groups}
							onMeetingMoved={onMeetingMoved}
							onMeetingDeleted={onMeetingDeleted}
							onRename={onRename}
							onDelete={onDelete}
						/>
					))}
				</ul>
			)}
		</div>
	);
}
