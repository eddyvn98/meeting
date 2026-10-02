"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";

/**
 * Shown when MeetingDetail.isMockResult is true — the transcript/summary
 * below is mock-complete/route.ts's placeholder, not a real transcription
 * (local/server STT failed or timed out). Retry calls
 * POST /api/meeting/[meetingId]/reprocess (flips status back to PROCESSING;
 * the saved audio itself was never touched) then navigates to the
 * Processing screen, which always re-runs the real pipeline on mount.
 */
export function MeetingMockResultBanner({ meetingId }: { meetingId: string }) {
	const router = useRouter();
	const [retrying, setRetrying] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const retry = async () => {
		setRetrying(true);
		setError(null);
		try {
			const res = await fetch(`/api/meeting/${meetingId}/reprocess`, { method: "POST" });
			if (!res.ok) throw new Error(`Retry failed (${res.status})`);
			router.push(`/meeting/${meetingId}/processing`);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Retry failed");
			setRetrying(false);
		}
	};

	return (
		<div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40 sm:mx-6">
			<div className="flex items-start gap-2">
				<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
				<p className="text-xs text-amber-800 dark:text-amber-300">
					This is a placeholder result — real transcription didn&apos;t complete for this meeting.
					{error && <span className="block font-medium">{error}</span>}
				</p>
			</div>
			<button
				type="button"
				onClick={retry}
				disabled={retrying}
				className="flex shrink-0 items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
			>
				{retrying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
				{retrying ? "Retrying…" : "Retry transcription"}
			</button>
		</div>
	);
}
