"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

interface AudioParts {
	merged: boolean;
	parts: { sequence: number; sizeBytes: number; durationSec: number | null }[];
}

const formatSize = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Download links for a recording whose transcription or merge did not work.
 *  Shows the whole recording when the server could merge it, and otherwise
 *  every stored part (each one plays on its own), so the audio is never
 *  stranded behind a broken step. */
export function AudioRescuePanel({ meetingId }: { meetingId: string }) {
	const [info, setInfo] = useState<AudioParts | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		fetch(`/api/meeting/${meetingId}/audio-parts`, { cache: "no-store" })
			.then((res) => (res.ok ? (res.json() as Promise<AudioParts>) : Promise.reject(new Error(String(res.status)))))
			.then((data) => !cancelled && setInfo(data))
			.catch(() => !cancelled && setFailed(true));
		return () => {
			cancelled = true;
		};
	}, [meetingId]);

	if (failed) return <p className="text-xs text-muted-foreground">The recording could not be listed right now. Try again in a moment.</p>;
	if (!info) return <p className="text-xs text-muted-foreground">Looking for the recording…</p>;
	if (!info.merged && info.parts.length === 0) return <p className="text-xs text-muted-foreground">No audio is stored for this meeting.</p>;

	const link = "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted";
	return (
		<div className="flex flex-col gap-2">
			{info.merged ? (
				<a href={`/api/meeting/${meetingId}/audio`} download className={link}>
					<Download className="h-3.5 w-3.5" /> Download the recording
				</a>
			) : (
				<>
					<p className="text-xs text-muted-foreground">The recording is stored in {info.parts.length} part{info.parts.length === 1 ? "" : "s"}. Download them all; they play in order.</p>
					<div className="flex flex-wrap gap-1.5">
						{info.parts.map((part) => (
							<a key={part.sequence} href={`/api/meeting/${meetingId}/audio?part=${part.sequence}`} download className={link}>
								<Download className="h-3.5 w-3.5" /> Part {part.sequence + 1} · {formatSize(part.sizeBytes)}
							</a>
						))}
					</div>
				</>
			)}
		</div>
	);
}
