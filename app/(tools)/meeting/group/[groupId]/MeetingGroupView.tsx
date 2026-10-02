"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { formatDateLabel } from "@/lib/meeting/format";
import type { Meeting, MeetingGroup } from "@/lib/meeting/types";
import { MeetingGroupAskPanel } from "./MeetingGroupAskPanel";

/**
 * Group page body: the folder's name/meeting count, a checklist of its
 * meetings (default all ticked) picking which ones "Ask across this group"
 * should actually use, and the Ask panel itself. Kept as one flex-row
 * layout (checklist left, Ask panel right on wide screens) so the selection
 * and the conversation are visible at the same time.
 */
export function MeetingGroupView({ group, meetings }: { group: MeetingGroup; meetings: Meeting[] }) {
	const [selected, setSelected] = useState<Set<string>>(() => new Set(meetings.map((m) => m.id)));

	const toggle = (id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	return (
		<div className="mx-auto flex h-full max-w-5xl flex-col gap-4 p-6">
			<div>
				<h1 className="text-lg font-semibold text-foreground">{group.name}</h1>
				<p className="text-sm text-muted-foreground">
					{meetings.length} meeting{meetings.length === 1 ? "" : "s"} in this group
				</p>
			</div>

			<div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
				<div className="flex w-full flex-col gap-1.5 lg:w-72 lg:shrink-0">
					<p className="text-xs font-medium text-muted-foreground">
						Include in the question below ({selected.size}/{meetings.length})
					</p>
					{meetings.length === 0 ? (
						<p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
							No meetings filed here yet — move one in from the sidebar.
						</p>
					) : (
						<ul className="flex flex-col gap-1 overflow-y-auto lg:max-h-[60vh]">
							{meetings.map((meeting) => (
								<li key={meeting.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted">
									<input
										type="checkbox"
										checked={selected.has(meeting.id)}
										onChange={() => toggle(meeting.id)}
										className="shrink-0"
									/>
									<Link href={`/meeting/${meeting.id}`} className="flex min-w-0 flex-1 items-center gap-1.5 hover:underline">
										<FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
										<span className="min-w-0 flex-1 truncate" title={meeting.title}>{meeting.title}</span>
									</Link>
									<span className="shrink-0 text-[10px] text-muted-foreground">{formatDateLabel(meeting.createdAt)}</span>
								</li>
							))}
						</ul>
					)}
				</div>

				<div className="min-h-0 flex-1">
					<MeetingGroupAskPanel groupId={group.id} groupName={group.name} selectedMeetingIds={Array.from(selected)} />
				</div>
			</div>
		</div>
	);
}
