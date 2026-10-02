"use client";

import { AlertTriangle, Download } from "lucide-react";
import type { MeetingDetail } from "@/lib/meeting/types";
import { computeAudioExpiry } from "@/lib/meeting/audioRetention";
import { useAudioRetentionDays } from "@/lib/meeting/useAudioRetentionDays";

/**
 * Warns about the scheduled audio-cleanup sweep (cleanupMeetingAudio.ts)
 * before — and after — it deletes this meeting's audio file. Renders
 * nothing until the sweep is within AUDIO_EXPIRY_WARNING_DAYS or has already
 * run (see lib/meeting/audioRetention.ts); the transcript/summary are never
 * affected by that sweep, only the audio file, so the banner is always
 * careful to say so.
 */
export function MeetingAudioExpiryBanner({ meeting }: { meeting: MeetingDetail }) {
	const retentionDays = useAudioRetentionDays();
	const expiry = retentionDays !== null ? computeAudioExpiry(meeting, retentionDays) : null;
	if (!expiry || (!expiry.isExpiringSoon && !expiry.isExpired)) return null;

	return (
		<div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40 sm:mx-6">
			<div className="flex items-start gap-2">
				<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
				<p className="text-xs text-amber-800 dark:text-amber-300">
					{expiry.isExpired ? (
						<>
							This meeting&apos;s audio recording has been auto-deleted (kept for {retentionDays} days after
							processing to save storage). The transcript and summary below are unaffected.
						</>
					) : (
						<>
							This meeting&apos;s audio recording will be auto-deleted in {expiry.daysLeft} day
							{expiry.daysLeft === 1 ? "" : "s"} (on {expiry.expiresAt.toLocaleDateString()}). Download it now if
							you want to keep the recording — the transcript and summary stay either way.
						</>
					)}
				</p>
			</div>
			{!expiry.isExpired && meeting.audioUrl && (
				<a
					href={meeting.audioUrl}
					download
					className="flex shrink-0 items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
				>
					<Download className="h-3.5 w-3.5" />
					Download recording
				</a>
			)}
		</div>
	);
}
