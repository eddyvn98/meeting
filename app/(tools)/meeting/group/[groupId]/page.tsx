"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ProtectedRoute from "@/components/features/auth/protected-route";
import { useToolLayoutSlots } from "@/hooks/use-tool-layout-slots";
import { MeetingAside } from "../../components/MeetingAside";
import type { Meeting, MeetingGroup } from "@/lib/meeting/types";
import { MeetingGroupView } from "./MeetingGroupView";

interface GroupDetail {
	group: MeetingGroup;
	meetings: Meeting[];
}

/**
 * "Ask across this group" page — reached from the sidebar's group section
 * (MeetingAsideGroupSection.tsx). Loads the group plus its own meetings via
 * GET /api/meeting/groups/[groupId] and hands them to MeetingGroupView,
 * which lets the caller tick which of those meetings the aggregate Ask
 * question should actually be answered from.
 */
export default function MeetingGroupPage() {
	useToolLayoutSlots({ showHistory: false, aside: <MeetingAside /> });
	const params = useParams<{ groupId: string }>();
	const groupId = params?.groupId;

	const [detail, setDetail] = useState<GroupDetail | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (!groupId) return;
		let cancelled = false;
		setLoading(true);
		setError(null);
		fetch(`/api/meeting/groups/${groupId}`)
			.then((res) => (res.ok ? (res.json() as Promise<GroupDetail>) : Promise.reject(res)))
			.then((data) => {
				if (!cancelled) setDetail(data);
			})
			.catch(() => {
				if (!cancelled) setError("Group not found.");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [groupId]);

	return (
		<ProtectedRoute>
			<div className="h-full w-full overflow-y-auto bg-background">
				{loading ? (
					<p className="p-6 text-sm text-muted-foreground">Loading…</p>
				) : error || !detail ? (
					<p className="p-6 text-sm text-muted-foreground">{error ?? "Group not found."}</p>
				) : (
					<MeetingGroupView group={detail.group} meetings={detail.meetings} />
				)}
			</div>
		</ProtectedRoute>
	);
}
