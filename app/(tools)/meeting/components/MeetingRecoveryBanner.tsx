"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
	discardRecovery,
	findRecoveryCandidate,
	resumeRecovery,
	type RecoveryCandidate,
} from "@/lib/meeting/recorder/recovery";
import { acquireMeetingActivity } from "@/lib/meeting/meetingActivityLock";

function getRecoveryMessage(candidate: RecoveryCandidate): string {
	const { session, pendingUploadCount } = candidate;
	if (pendingUploadCount === 0) return `"${session.title}" was uploaded but not finalized.`;
	if (session.status === "recording") {
		return `"${session.title}" was interrupted before End Meeting; ${pendingUploadCount} audio chunk${pendingUploadCount === 1 ? "" : "s"} remain${pendingUploadCount === 1 ? "s" : ""} to upload.`;
	}
	return `"${session.title}" has ${pendingUploadCount} audio chunk${pendingUploadCount === 1 ? "" : "s"} that never finished uploading.`;
}

/**
 * Surfaces recovery.ts's findRecoveryCandidate() as an actual banner on the
 * Home and ready-to-record screens. It asks whether the user wants to resume
 * or discard an earlier recording whose chunks never finished uploading (for
 * example, after a tab close or crash). Without this, a failed
 * upload had genuinely no path back: the in-session retry-with-backoff
 * (uploadQueue.ts) only runs while the tab stays open.
 */
export function MeetingRecoveryBanner() {
	const router = useRouter();
	const [candidate, setCandidate] = useState<RecoveryCandidate | null>(null);
	const [resuming, setResuming] = useState(false);
	const [progress, setProgress] = useState<{ uploaded: number; total: number } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	useEffect(() => {
		let cancelled = false;
		findRecoveryCandidate()
			.then((found) => {
				if (!cancelled) setCandidate(found);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => () => abortRef.current?.abort(), []);

	if (!candidate) return null;
	const hasNothingToRecover = candidate.pendingUploadCount === 0 && candidate.chunks.length === 0;
	if (hasNothingToRecover) return null;
	const recoveryMessage = getRecoveryMessage(candidate);
	const resumeLabel = candidate.pendingUploadCount > 0 ? "Resume upload" : "Finalize recording";

	const handleResume = async () => {
		setResuming(true);
		const releaseActivity = acquireMeetingActivity("uploading");
		setError(null);
		const controller = new AbortController();
		abortRef.current = controller;
		try {
			await resumeRecovery(candidate, (uploaded, total) => setProgress({ uploaded, total }), controller.signal);
			if (controller.signal.aborted) return;
			router.push(`/meeting/${candidate.session.meetingId}/processing`);
		} catch (error) {
			setError(error instanceof Error ? error.message : "Still couldn't upload — check your connection and try again.");
		} finally {
			setResuming(false);
			releaseActivity();
		}
	};

	const handleDiscard = async () => {
		// Discarding deletes the only copy of any audio that has not reached the server.
		if (candidate.pendingUploadCount > 0 && !window.confirm(`${candidate.pendingUploadCount} audio chunk${candidate.pendingUploadCount === 1 ? " has" : "s have"} not been uploaded yet. Discarding permanently deletes that audio from this browser. Discard anyway?`)) return;
		await discardRecovery(candidate);
		setCandidate(null);
	};

	return (
		<div className="flex w-full items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
			<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
			<div className="flex-1">
					<p className="font-medium text-amber-900 dark:text-amber-200">
						{recoveryMessage}
					</p>
					<p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
						{candidate.pendingUploadCount > 0
							? "The recording is saved locally after a tab close, reload, or lost connection."
							: "The audio chunks are already uploaded; the recording only needs finalization."}
					</p>
				{resuming && progress && (
					<p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
						Uploading… {progress.uploaded}/{progress.total} chunks
					</p>
				)}
				{error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<button
					type="button"
					onClick={handleDiscard}
					disabled={resuming}
					className="rounded-md px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-amber-300 dark:hover:bg-amber-900/40"
				>
					Discard
				</button>
				<button
					type="button"
					onClick={handleResume}
					disabled={resuming}
					className="flex items-center gap-1.5 rounded-md bg-brand-orange px-2.5 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
				>
					{resuming && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
					{resuming ? "Resuming…" : resumeLabel}
				</button>
			</div>
		</div>
	);
}
