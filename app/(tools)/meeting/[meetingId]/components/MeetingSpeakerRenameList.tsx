"use client";

import { useMemo, useState } from "react";
import { BookUser, PlayCircle, Trash2, Users, X } from "lucide-react";
import { UNKNOWN_SPEAKER_NAME, type Speaker, type SpeakerMapping, type TranscriptSegment } from "@/lib/meeting/types";
import { useMeetingAudioSeek } from "./MeetingAudioSeekContext";
import { MeetingVoiceDirectoryPanel } from "./MeetingVoiceDirectoryPanel";
import { MeetingParticipantPicker } from "./MeetingParticipantPicker";

interface SpeakerGroup {
	displayName: string;
	speakerKeys: string[];
	sampleMs: number | null;
}

/**
 * Speaker identity for this meeting, grouped by resolved name rather than by
 * raw speakerKey — diarization (and voice-directory auto-recognition) often
 * splits one real person into several speakerKeys, and showing the same
 * recognized name three times over was more confusing than helpful. Naming
 * a speaker no longer happens by typing directly into a chip: identity comes
 * from the Merge control below, whose "into" list is seeded by whichever chips are already
 * named PLUS whatever names are picked from the shared voice directory (see
 * MeetingParticipantPicker) — merging a group folds it into the target
 * group automatically, since they end up sharing one displayName. A chip's
 * only per-speaker actions are: play a sample (to check who it actually is)
 * and delete (mark as noise/not-a-real-person — see UNKNOWN_SPEAKER_NAME).
 */
export function MeetingSpeakerRenameList({
	meetingId,
	speakers,
	speakerMappings,
	participantNames,
	segments,
	nameOverrides,
	onRenamed,
	activeFilter,
	onFilterChange,
}: {
	meetingId: string;
	speakers: Speaker[];
	speakerMappings: SpeakerMapping[];
	participantNames: string[];
	segments: TranscriptSegment[];
	nameOverrides: Record<string, string>;
	onRenamed: (speakerKey: string, displayName: string) => void;
	/** Currently-filtered speaker's displayName, or null for "show everyone"
	 *  — owned by MeetingTranscriptTab since that's what actually filters the
	 *  segment rows below; this component only needs it to highlight the
	 *  active chip and toggle it on click. */
	activeFilter: string | null;
	onFilterChange: (name: string | null) => void;
}) {
	const { seekTo } = useMeetingAudioSeek();
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [mergeSource, setMergeSource] = useState("");
	const [mergeTarget, setMergeTarget] = useState("");
	const [showDirectory, setShowDirectory] = useState(false);
	const [manualParticipantNames, setManualParticipantNames] = useState<string[]>([]);

	const mappingByKey = new Map(speakerMappings.map((m) => [m.speakerKey, m.displayName]));
	const nameFor = (speakerKey: string) =>
		nameOverrides[speakerKey] ?? mappingByKey.get(speakerKey) ?? speakerKey;

	const groups = useMemo(() => {
		const byName = new Map<string, SpeakerGroup>();
		const keyToName = new Map<string, string>();
		for (const speaker of speakers) {
			const name = nameFor(speaker.speakerKey);
			keyToName.set(speaker.speakerKey, name);
			const group = byName.get(name) ?? { displayName: name, speakerKeys: [], sampleMs: null };
			group.speakerKeys.push(speaker.speakerKey);
			byName.set(name, group);
		}
		// Longest segment across every speakerKey folded into a group — a
		// longer clip is a clearer, less-clipped sample to listen to.
		const longestDurationByName = new Map<string, number>();
		for (const segment of segments) {
			const name = keyToName.get(segment.speakerKey);
			if (!name) continue;
			const durationMs = segment.endTimeMs - segment.startTimeMs;
			if (durationMs > (longestDurationByName.get(name) ?? -1)) {
				longestDurationByName.set(name, durationMs);
				byName.get(name)!.sampleMs = segment.startTimeMs;
			}
		}
		return Array.from(byName.values());
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [speakers, segments, nameOverrides, speakerMappings]);

	const rename = async (speakerKey: string, displayName: string) => {
		const res = await fetch(`/api/meeting/${meetingId}/speakers`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ speakerKey, displayName }),
		});
		if (!res.ok) throw new Error(`Update failed (${res.status})`);
		onRenamed(speakerKey, displayName);
	};

	const renameGroup = async (group: SpeakerGroup, displayName: string) => {
		setSaving(true);
		setError(null);
		try {
			for (const speakerKey of group.speakerKeys) {
				await rename(speakerKey, displayName);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Update failed");
		} finally {
			setSaving(false);
		}
	};

	const submitMerge = async () => {
		const sourceGroup = groups.find((g) => g.displayName === mergeSource);
		if (!sourceGroup || !mergeTarget || mergeSource === mergeTarget) return;
		await renameGroup(sourceGroup, mergeTarget);
		setMergeSource("");
		setMergeTarget("");
	};

	const mergeTargetOptions = Array.from(
		new Set([...groups.map((g) => g.displayName), ...participantNames, ...manualParticipantNames]),
	).sort();

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
				<div className="flex items-center justify-between">
					<h3 className="text-sm font-semibold text-card-foreground">Speakers</h3>
					<button
						type="button"
						onClick={() => setShowDirectory((v) => !v)}
						className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<BookUser className="h-3.5 w-3.5" />
						{showDirectory ? "Hide voice directory" : "Voice directory"}
					</button>
				</div>

				{activeFilter && (
					<p className="text-[11px] text-muted-foreground">
						Showing only <span className="font-medium text-foreground">{activeFilter}</span>'s lines —{" "}
						<button type="button" onClick={() => onFilterChange(null)} className="underline hover:text-foreground">
							clear filter
						</button>
					</p>
				)}

				<ul className="flex flex-wrap gap-2">
					{groups.map((group) => (
						<li
							key={group.displayName}
							className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
								activeFilter === group.displayName
									? "border-brand-orange bg-brand-orange-light/40 dark:bg-amber-950/20"
									: "border-border bg-muted"
							}`}
						>
							<button
								type="button"
								onClick={() => onFilterChange(activeFilter === group.displayName ? null : group.displayName)}
								title="Show only this speaker's lines"
								className="font-medium text-foreground hover:underline"
							>
								{group.displayName}
							</button>
							{group.sampleMs !== null && (
								<button
									type="button"
									onClick={() => seekTo(group.sampleMs!, { autoScroll: false })}
									aria-label={`Play sample of ${group.displayName}`}
									title="Play a sample of this speaker"
								>
									<PlayCircle className="h-3.5 w-3.5 text-muted-foreground hover:text-brand-orange" />
								</button>
							)}
							{group.displayName !== UNKNOWN_SPEAKER_NAME && (
								<button
									type="button"
									onClick={() => renameGroup(group, UNKNOWN_SPEAKER_NAME)}
									disabled={saving}
									aria-label={`Mark ${group.displayName} as not a real speaker`}
									title="Not a real speaker (noise)"
								>
									<Trash2 className="h-3 w-3 text-muted-foreground hover:text-red-600" />
								</button>
							)}
						</li>
					))}
				</ul>

				{error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

				{participantNames.length > 0 && (
					<div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
						<Users className="h-3.5 w-3.5" />
						<span className="mr-1 font-medium text-foreground">Participants detected in Teams</span>
						{participantNames.map((name) => (
							<span key={name} className="rounded-full border border-border bg-muted px-2 py-0.5">
								{name}
							</span>
						))}
					</div>
				)}

				<MeetingParticipantPicker
					existingNames={mergeTargetOptions}
					onAdd={(name) => setManualParticipantNames((prev) => [...prev, name])}
				/>

				{/* Confirms each name actually landed in the "into" list below — add
				    as many people as are in this meeting, one at a time; each shows
				    up here immediately so it's clear the picker doesn't replace the
				    previous pick. Removing one here only drops it from this
				    suggestion pool, it never affects an already-completed merge. */}
				{manualParticipantNames.length > 0 && (
					<ul className="flex flex-wrap gap-1.5">
						{manualParticipantNames.map((name) => (
							<li
								key={name}
								className="flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground"
							>
								{name}
								<button
									type="button"
									onClick={() => setManualParticipantNames((prev) => prev.filter((n) => n !== name))}
									aria-label={`Remove ${name} from participant list`}
								>
									<X className="h-3 w-3 hover:text-foreground" />
								</button>
							</li>
						))}
					</ul>
				)}

				{groups.length > 1 && (
					<div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs">
						<Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
						<span className="text-muted-foreground">Merge speaker</span>
						<select
							value={mergeSource}
							onChange={(e) => setMergeSource(e.target.value)}
							className="rounded border border-border bg-background px-1.5 py-1 text-foreground"
						>
							<option value="">Select…</option>
							{groups.map((g) => (
								<option key={g.displayName} value={g.displayName}>
									{g.displayName}
								</option>
							))}
						</select>
						<span className="text-muted-foreground">into</span>
						<select
							value={mergeTarget}
							onChange={(e) => setMergeTarget(e.target.value)}
							className="rounded border border-border bg-background px-1.5 py-1 text-foreground"
						>
							<option value="">Select…</option>
							{mergeTargetOptions.map((name) => (
								<option key={name} value={name}>
									{name}
								</option>
							))}
						</select>
						<button
							type="button"
							onClick={submitMerge}
							disabled={!mergeSource || !mergeTarget || mergeSource === mergeTarget || saving}
							className="rounded-md bg-brand-orange px-2.5 py-1 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
						>
							Merge
						</button>
						<span className="basis-full text-[11px] text-muted-foreground">
							Renames every speakerKey in the source group to match the target — the API has no
							true merge yet, so segments keep separate speaker IDs.
						</span>
					</div>
				)}
			</div>

			{showDirectory && <MeetingVoiceDirectoryPanel />}
		</div>
	);
}
