"use client";

import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";

/**
 * "Add meeting participant" — lets the user pull a name from the shared
 * voice directory (or type a brand-new one, for someone never enrolled
 * before) into this meeting's Merge speaker "into" list, WITHOUT running any
 * voice matching. Picking a name here is purely a hint for the merge
 * dropdown (see MeetingSpeakerRenameList.tsx) — the user still manually
 * picks which unidentified chip actually is that person and merges it.
 */
export function MeetingParticipantPicker({
	onAdd,
	existingNames,
}: {
	onAdd: (name: string) => void;
	existingNames: string[];
}) {
	const [directoryNames, setDirectoryNames] = useState<string[]>([]);
	const [draft, setDraft] = useState("");
	const [notice, setNotice] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		fetch("/api/meeting/voice-profiles?summary=1", { cache: "no-store" })
			.then((res) => (res.ok ? (res.json() as Promise<{ displayName: string }[]>) : []))
			.then((rows) => {
				if (!cancelled) setDirectoryNames(rows.map((r) => r.displayName));
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	const submit = () => {
		const name = draft.trim();
		if (!name) return;
		if (existingNames.includes(name)) {
			// Already a speaker chip or an already-added participant — nothing
			// new to do, but silently no-op'ing here is exactly what confused a
			// user into thinking the Add button was broken. Say so instead.
			setNotice(`"${name}" is already in this meeting's list.`);
			setTimeout(() => setNotice(null), 3000);
			return;
		}
		onAdd(name);
		setDraft("");
		setNotice(null);
	};

	return (
		<div className="flex flex-wrap items-center gap-2 text-xs">
			<UserPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			<span className="text-muted-foreground">Add meeting participant</span>
			<input
				list="voice-directory-names"
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onKeyDown={(e) => e.key === "Enter" && submit()}
				placeholder="Pick from directory or type a new name"
				className="w-56 rounded border border-border bg-background px-1.5 py-1 text-foreground"
			/>
			<datalist id="voice-directory-names">
				{directoryNames.map((name) => (
					<option key={name} value={name} />
				))}
			</datalist>
			<button
				type="button"
				onClick={submit}
				disabled={!draft.trim()}
				className="rounded-md border border-border px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
			>
				Add
			</button>
			{notice && <span className="basis-full text-[11px] text-amber-600 dark:text-amber-400">{notice}</span>}
		</div>
	);
}
