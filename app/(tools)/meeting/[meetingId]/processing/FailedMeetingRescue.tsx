"use client";

import { Button } from "@/components/ui/button";
import { AudioRescuePanel } from "../../components/AudioRescuePanel";
import { useOpenRecordingOnly } from "../../components/useOpenRecordingOnly";

/** Shown on the Processing screen when the meeting is FAILED: the recording is
 *  still stored, so offer to open it (empty Overview, play and download) and
 *  to download it right here. */
export function FailedMeetingRescue({ meetingId, reason }: { meetingId: string; reason: string | null }) {
	const recordingOnly = useOpenRecordingOnly(meetingId);
	return (
		<div className="flex w-full flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4">
			<p className="text-sm font-medium text-foreground">Your recording is not lost</p>
			<p className="text-xs text-muted-foreground">You can open the meeting without a transcript, or download the audio now.</p>
			<div>
				<Button size="sm" disabled={recordingOnly.busy} onClick={() => void recordingOnly.open(reason ?? undefined)}>
					{recordingOnly.busy ? "Opening…" : "Open the recording"}
				</Button>
				{recordingOnly.error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{recordingOnly.error}</p>}
			</div>
			<AudioRescuePanel meetingId={meetingId} />
		</div>
	);
}
