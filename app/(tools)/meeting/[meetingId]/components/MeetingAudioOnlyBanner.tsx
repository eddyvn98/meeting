"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { audioOnlyReason } from "@/lib/meeting/audio/audioOnly";
import { AudioRescuePanel } from "../../components/AudioRescuePanel";

/** Shown instead of a transcript when transcription did not complete. The
 *  recording itself is safe: play it above, download it here, or retry
 *  transcription (flips the meeting back to PROCESSING and re-runs it). */
export function MeetingAudioOnlyBanner({ meetingId, failureReason, canRetry }: { meetingId: string; failureReason: string | null; canRetry: boolean }) {
	const router = useRouter();
	const [retrying, setRetrying] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const reason = audioOnlyReason(failureReason);

	const retry = async () => {
		setRetrying(true);
		setError(null);
		try {
			const res = await fetch(`/api/meeting/${meetingId}/reprocess`, { method: "POST" });
			if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Retry failed (${res.status})`);
			router.push(`/meeting/${meetingId}/processing`);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Retry failed");
			setRetrying(false);
		}
	};

	return (
		<div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 dark:border-amber-900 dark:bg-amber-950/40">
			<div className="flex items-start gap-2">
				<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium text-amber-900 dark:text-amber-200">There is no transcript for this meeting yet</p>
					<p className="text-xs text-amber-800 dark:text-amber-300">The recording is saved. Play it above or download it below.{reason && ` Reason: ${reason}`}</p>
					{error && <p className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">{error}</p>}
				</div>
				{canRetry && (
					<button
						type="button"
						onClick={retry}
						disabled={retrying}
						className="flex shrink-0 items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
					>
						{retrying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
						{retrying ? "Retrying…" : "Retry transcription"}
					</button>
				)}
			</div>
			<AudioRescuePanel meetingId={meetingId} />
		</div>
	);
}
