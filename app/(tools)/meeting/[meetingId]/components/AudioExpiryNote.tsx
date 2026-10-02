import { Clock } from "lucide-react";
import { describeAudioExpiry, type AudioExpiryInfo } from "@/lib/meeting/audioRetention";

/** Countdown until the scheduled cleanup deletes the recording. Shown at the
 *  player and in the download list; the transcript and summary are kept. */
export function AudioExpiryNote({ expiry, className = "" }: { expiry: AudioExpiryInfo; className?: string }) {
	return (
		<span
			className={`inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 ${className}`}
			title="Only the audio file is deleted. The transcript and summary are kept."
		>
			<Clock className="h-3 w-3 shrink-0" />
			{describeAudioExpiry(expiry)}
		</span>
	);
}
