"use client";

import { useEffect, useState } from "react";
import type { MeetingGroup } from "./types";

/**
 * Fetches the caller's sidebar folders (MeetingAside.tsx "Groups" section)
 * once on mount and exposes create/rename/delete, each patching local state
 * on success instead of refetching the whole list. Lifted out of
 * MeetingAsideGroupList.tsx so MeetingAside.tsx can also hand `groups` to
 * the plain (ungrouped) Recent list's rows — an ungrouped meeting needs the
 * same "Move to group" options a grouped one has.
 */
export function useMeetingGroups() {
	const [groups, setGroups] = useState<MeetingGroup[]>([]);

	useEffect(() => {
		fetch("/api/meeting/groups")
			.then((res) => (res.ok ? (res.json() as Promise<MeetingGroup[]>) : []))
			.then(setGroups)
			.catch(() => undefined);
	}, []);

	const createGroup = async (name: string) => {
		const res = await fetch("/api/meeting/groups", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name }),
		});
		if (res.ok) {
			const created = (await res.json()) as MeetingGroup;
			setGroups((prev) => [...prev, created]);
		}
	};

	const renameGroup = async (groupId: string, name: string) => {
		const res = await fetch(`/api/meeting/groups/${groupId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name }),
		});
		if (res.ok) setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, name } : g)));
	};

	const deleteGroup = async (groupId: string): Promise<boolean> => {
		const res = await fetch(`/api/meeting/groups/${groupId}`, { method: "DELETE" });
		if (res.ok) setGroups((prev) => prev.filter((g) => g.id !== groupId));
		return res.ok;
	};

	return { groups, createGroup, renameGroup, deleteGroup };
}
