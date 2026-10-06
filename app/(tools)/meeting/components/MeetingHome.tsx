"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, UploadCloud, FileText, MoreHorizontal, Loader2 } from "lucide-react";
import { uploadRecordingFile, retryUploadRecordingFile, RecordingUploadError, FileTooLargeError, UPLOAD_SOURCE_QUERY } from "@/lib/meeting/recorder/fileUploadPipeline";
import { formatDateLabel, formatDurationSec } from "@/lib/meeting/format";
import type { Meeting } from "@/lib/meeting/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { MeetingRecoveryBanner } from "./MeetingRecoveryBanner";
import { prepareCapture } from "@/lib/meeting/recorder/captureAudio";
import { useMeetingOptions } from "./useMeetingOptions";
import { LanguageControl, ModeControl } from "./MeetingOptionControls";
import { ActionTile } from "./MeetingHomeTiles";
import { acquireMeetingActivity } from "@/lib/meeting/meetingActivityLock";

/**
 * Meeting home screen: recording actions and a recent meetings list,
 * a two-action card (each action carries its own language and model; live
 * transcript/translation are switched inside the recording screen), and recent meetings list.
 */
export function MeetingHome() {
	const router = useRouter();
	const isMobile = useIsMobile();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [isStartingMeeting, setIsStartingMeeting] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [startError, setStartError] = useState<string | null>(null);
	const [failedUpload, setFailedUpload] = useState<{ meetingId: string; file: File } | null>(null);
	const [recentMeetings, setRecentMeetings] = useState<Meeting[]>([]);
	const [isLoadingMeetings, setIsLoadingMeetings] = useState(true);
	// Separate option sets: changing the record block never changes the upload block.
	const recordOptions = useMeetingOptions("record");
	const uploadOptions = useMeetingOptions("upload");
	const { sttLanguage: uploadLanguage, transcriptionMode: uploadMode } = uploadOptions;

	function processingHref(meetingId: string): string {
		const query = new URLSearchParams(isMobile ? UPLOAD_SOURCE_QUERY.slice(1) : "");
		query.set("mode", uploadMode);
		return `/meeting/${meetingId}/processing?${query.toString()}`;
	}

	useEffect(() => {
		let cancelled = false;
		fetch("/api/meeting")
			.then((res) => (res.ok ? res.json() : Promise.reject(res)))
			.then((meetings: Meeting[]) => {
				if (!cancelled) setRecentMeetings(meetings.slice(0, 5));
			})
			.catch(() => {
				// Intentionally ignore fetch errors and fall back to empty recent meetings list
			})
			.finally(() => {
				if (!cancelled) setIsLoadingMeetings(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function handleStartMeeting() {
		if (isStartingMeeting) return;
		setIsStartingMeeting(true);
		setStartError(null);
		try {
			const capture = await prepareCapture(isMobile ? "microphone" : "display");
			if (capture.error) {
				setStartError(capture.error.message);
				return;
			}
			const botTitle = new URLSearchParams(window.location.search).get("title")?.trim();
			router.push(botTitle ? `/meeting/record?title=${encodeURIComponent(botTitle)}` : "/meeting/record");
		} catch (error) {
			setStartError(error instanceof Error ? error.message : "Failed to start audio capture.");
		} finally {
			setIsStartingMeeting(false);
		}
	}

	function handleUploadClick() {
		setUploadError(null);
		setFailedUpload(null);
		fileInputRef.current?.click();
	}

	async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) return;
		setIsUploading(true);
		const releaseActivity = acquireMeetingActivity("uploading");
		setUploadError(null);
		setFailedUpload(null);
		try {
			const { meetingId } = await uploadRecordingFile(file, file.name.replace(/\.[^.]+$/, ""), uploadLanguage);
			router.push(processingHref(meetingId));
		} catch (err) {
			if (err instanceof RecordingUploadError) setFailedUpload({ meetingId: err.meetingId, file });
			setUploadError(
				err instanceof FileTooLargeError ? err.message : "Failed to upload the recording. Please try again.",
			);
		} finally {
			setIsUploading(false);
			releaseActivity();
		}
	}

	async function handleRetryUpload() {
		if (!failedUpload) return;
		setIsUploading(true);
		const releaseActivity = acquireMeetingActivity("uploading");
		setUploadError(null);
		try {
			await retryUploadRecordingFile(failedUpload.meetingId, failedUpload.file);
			router.push(processingHref(failedUpload.meetingId));
		} catch {
			setUploadError("Still failing to upload. Check your connection and try again.");
		} finally {
			setIsUploading(false);
			releaseActivity();
		}
	}

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-10 px-4 py-16">
			<div className="flex flex-col items-center gap-4 text-center">
				<div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-orange/10 text-brand-orange">
					<Mic aria-hidden="true" className="h-6 w-6" />
				</div>
				<div>
					<h1 className="text-2xl font-semibold text-foreground">Welcome to Meeting</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Record or upload a meeting to get an AI-generated summary,
						transcript, and action items.
					</p>
				</div>
			</div>

			<MeetingRecoveryBanner />

			<div className={`grid w-full grid-cols-1 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card ${isMobile ? "" : "sm:grid-cols-2 sm:divide-x sm:divide-y-0"}`}>
				<ActionTile
					icon={<Mic className="h-5 w-5 text-brand-orange" />}
					title={isStartingMeeting ? "Preparing..." : "Start Meeting"}
					subtitle={isStartingMeeting
						? (isMobile ? "Waiting for microphone permission" : "Waiting for audio-sharing permission")
						: (isMobile ? "Record from your phone microphone" : "Record tab audio and microphone")}
					onClick={handleStartMeeting}
					disabled={isStartingMeeting}
				>
					<LanguageControl options={recordOptions} />
					<ModeControl options={recordOptions} paidOnly={recordOptions.mobileDevice} />
				</ActionTile>
				<ActionTile
					icon={isUploading ? <Loader2 className="h-5 w-5 animate-spin text-brand-orange" /> : <UploadCloud className="h-5 w-5 text-brand-orange" />}
					title={isUploading ? "Uploading..." : "Upload Recording"}
					subtitle="Upload an existing audio or video file"
					onClick={handleUploadClick}
					disabled={isUploading}
				>
					<LanguageControl options={uploadOptions} />
					<ModeControl options={uploadOptions} />
				</ActionTile>
			</div>
			{startError && <p className="-mt-6 text-center text-sm text-red-500">{startError}</p>}
			<input
				ref={fileInputRef}
				type="file"
				accept="audio/*,video/*"
				className="hidden"
				onChange={handleFileSelected}
			/>
			{uploadError && (
				<div className="-mt-6 flex items-center gap-3">
					<p className="text-sm text-red-500">{uploadError}</p>
					{failedUpload && (
						<button
							type="button"
							onClick={handleRetryUpload}
							disabled={isUploading}
							className="shrink-0 rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
						>
							Retry upload
						</button>
					)}
				</div>
			)}

			<div className="w-full">
				<div className="mb-3">
					<h2 className="text-sm font-semibold text-foreground">
						Recent Meetings
					</h2>
				</div>
				<div className="overflow-hidden rounded-xl border border-border bg-card">
					{isLoadingMeetings ? (
						<div className="p-8 text-center text-sm text-muted-foreground">
							Loading recent meetings...
						</div>
					) : recentMeetings.length === 0 ? (
						<div className="p-8 text-center text-sm text-muted-foreground">
							No meetings yet. Start a recording to create your first meeting.
						</div>
					) : (
						<ul className="divide-y divide-border">
							{recentMeetings.map((meeting) => (
								<li key={meeting.id}>
									<button
										type="button"
										onClick={() => router.push(`/meeting/${meeting.id}`)}
										className="flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-muted"
									>
										<div className="flex items-center gap-3 min-w-0">
											<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
												<FileText className="h-4 w-4" />
											</span>
											<div className="min-w-0">
												<div className="flex items-center gap-2">
													<p className="truncate text-sm font-medium text-foreground">
														{meeting.title}
													</p>
													{meeting.isLive && (
														<span className="shrink-0 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
															Live
														</span>
													)}
												</div>
												<p className="text-xs text-muted-foreground">
													{formatDateLabel(meeting.createdAt)}
													{meeting.durationSec
														? ` • ${formatDurationSec(meeting.durationSec)}`
														: ""}
												</p>
											</div>
										</div>
										<span
											role="button"
											aria-label="Meeting options"
											className="shrink-0 rounded p-1 text-muted-foreground opacity-60"
										>
											<MoreHorizontal className="h-4 w-4" />
										</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}
