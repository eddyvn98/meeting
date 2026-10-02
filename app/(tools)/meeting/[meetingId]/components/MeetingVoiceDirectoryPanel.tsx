"use client";

import { useEffect, useState } from "react";
import { Loader2, Trash2, Users2 } from "lucide-react";

interface VoiceProfileSummary {
	displayName: string;
	sampleCount: number;
	updatedAt: string;
}

/**
 * "Voice directory" — the read/manage surface for the company-wide
 * MeetingVoiceProfile library (lib/meeting/stt/voiceLibrary.ts). Every
 * speaker rename anywhere enrolls (or reinforces) an entry here, and every
 * new meeting's diarization checks against it first — so a name that keeps
 * getting auto-applied to the wrong voice, or one that's simply stale, can
 * be deleted from this one place instead of only being fixable meeting by
 * meeting. Shared company-wide (not scoped to this meeting), so deleting an
 * entry here affects every future meeting, not just the current one.
 */
export function MeetingVoiceDirectoryPanel() {
	const [profiles, setProfiles] = useState<VoiceProfileSummary[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [deletingName, setDeletingName] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		fetch("/api/meeting/voice-profiles?summary=1", { cache: "no-store" })
			.then((res) => {
				if (!res.ok) throw new Error(`Failed to load (${res.status})`);
				return res.json() as Promise<VoiceProfileSummary[]>;
			})
			.then((rows) => {
				if (!cancelled) setProfiles(rows);
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load voice directory");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const remove = async (displayName: string) => {
		setDeletingName(displayName);
		setError(null);
		try {
			const res = await fetch(`/api/meeting/voice-profiles?displayName=${encodeURIComponent(displayName)}`, {
				method: "DELETE",
			});
			if (!res.ok) throw new Error(`Delete failed (${res.status})`);
			setProfiles((prev) => prev?.filter((p) => p.displayName !== displayName) ?? prev);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Delete failed");
		} finally {
			setDeletingName(null);
		}
	};

	return (
		<div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
			<div className="flex items-center gap-1.5">
				<Users2 className="h-3.5 w-3.5 text-muted-foreground" />
				<h3 className="text-sm font-semibold text-card-foreground">Voice directory</h3>
			</div>
			<p className="text-[11px] text-muted-foreground">
				Every rename teaches this shared directory that voice, so future meetings auto-recognize it
				instead of showing an anonymous speaker. Remove an entry if it keeps matching the wrong person.
			</p>

			{error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

			{profiles === null ? (
				<div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
					<Loader2 className="h-3.5 w-3.5 animate-spin" />
					Loading…
				</div>
			) : profiles.length === 0 ? (
				<p className="py-2 text-xs text-muted-foreground">
					No one enrolled yet — rename a speaker to add the first entry.
				</p>
			) : (
				<ul className="flex flex-col divide-y divide-border">
					{profiles.map((p) => (
						<li key={p.displayName} className="flex items-center justify-between gap-3 py-2 text-xs">
							<div className="min-w-0">
								<span className="font-medium text-foreground">{p.displayName}</span>
								<span className="ml-2 text-muted-foreground">
									{p.sampleCount} sample{p.sampleCount === 1 ? "" : "s"} · updated{" "}
									{new Date(p.updatedAt).toLocaleDateString()}
								</span>
							</div>
							<button
								type="button"
								onClick={() => remove(p.displayName)}
								disabled={deletingName === p.displayName}
								aria-label={`Remove ${p.displayName} from voice directory`}
								className="shrink-0 text-muted-foreground hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<Trash2 className="h-3.5 w-3.5" />
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
