"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

/** Gives up on transcription for now: the meeting becomes a transcript-less
 *  Overview where the recording can be played and downloaded, and
 *  transcription can be retried later (POST /api/meeting/[id]/audio-only). */
export function useOpenRecordingOnly(meetingId: string | null) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const open = useCallback(
		async (reason?: string) => {
			if (!meetingId) return;
			setBusy(true);
			setError(null);
			try {
				const res = await fetch(`/api/meeting/${meetingId}/audio-only`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ reason }),
				});
				if (!res.ok) {
					const data = (await res.json().catch(() => null)) as { error?: string } | null;
					throw new Error(data?.error ?? `Could not open the recording (${res.status})`);
				}
				router.push(`/meeting/${meetingId}`);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Could not open the recording");
				setBusy(false);
			}
		},
		[meetingId, router],
	);

	return { open, busy, error };
}
