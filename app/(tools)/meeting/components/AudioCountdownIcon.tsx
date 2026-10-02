import type { AudioExpiryInfo } from "@/lib/meeting/audioRetention";

/**
 * app/(tools)/meeting/components/AudioCountdownIcon.tsx
 *
 * Replaces the plain document icon next to a sidebar row's title (see
 * MeetingAsideRecentItem.tsx) with a small ring showing how many days are
 * left before the scheduled cleanup sweep (cleanupMeetingAudio.ts) deletes
 * this meeting's audio file — ticks down once a day since it's driven by
 * `expiry.daysLeft`, itself derived from `updatedAt` (a fixed point) versus
 * `Date.now()` (see lib/meeting/audioRetention.ts). Always red to draw attention.
 */
export function AudioCountdownIcon({ expiry, retentionDays }: { expiry: AudioExpiryInfo; retentionDays: number }) {
	const label = expiry.isExpired ? "0" : String(Math.max(expiry.daysLeft, 1));
	// Always red so the countdown stands out in the sidebar list.
	const colorClass = "border-red-500 text-red-600 dark:border-red-400 dark:text-red-400";

	const title = expiry.isExpired
		? `Audio recording has been auto-deleted (kept for ${retentionDays} days after processing). Transcript and summary are unaffected.`
		: `Audio recording auto-deletes in ${expiry.daysLeft} day${expiry.daysLeft === 1 ? "" : "s"} (on ${expiry.expiresAt.toLocaleDateString()}). Transcript and summary are kept either way.`;

	return (
		<span
			title={title}
			className={`inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border ${colorClass}`}
		>
			<span className="text-[8px] font-bold leading-none tabular-nums">{label}</span>
		</span>
	);
}
