"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { formatClock } from "@/lib/meeting/format";
import type { AudioExpiryInfo } from "@/lib/meeting/audioRetention";
import { useMeetingAudioSeek } from "./MeetingAudioSeekContext";
import { AudioExpiryNote } from "./AudioExpiryNote";

// Ascending order for a dropdown list (was a shuffled cycle-button order —
// fine for repeated clicks, confusing to read top-to-bottom as a list).
const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const DEFAULT_SPEED = 1;
/** Remembers the user's last-picked playback speed across meetings/sessions —
 *  same pattern as TRANSLATE_LANG_STORAGE_KEY in translateLanguages.ts. */
const SPEED_STORAGE_KEY = "meeting-playback-speed";

function loadStoredSpeed(): number {
	if (typeof window === "undefined") return DEFAULT_SPEED;
	const raw = Number(localStorage.getItem(SPEED_STORAGE_KEY));
	return SPEED_STEPS.includes(raw as (typeof SPEED_STEPS)[number]) ? raw : DEFAULT_SPEED;
}

/**
 * Audio player docked right under the header (above the tabs) rather than
 * stuck to the bottom of the screen — it used to be a sticky bottom bar,
 * but that's the part of the screen scrolled to least, so it's a fixed row
 * here instead: play/pause, elapsed/total time, scrub bar (orange
 * progress/handle), a real mute toggle, and a playback-speed picker (a
 * dropdown list rather than a cycle button, so every speed is reachable in
 * one click and the last choice is remembered for next time). Wired to a
 * real `<audio>` element when `audioUrl` is present; otherwise renders
 * disabled controls with a "no audio" note (MeetingDetail may not have an
 * uploaded file yet, e.g. mid-processing).
 *
 * The fullscreen button this used to have was removed — there is no video
 * or other visual surface here for "fullscreen" to mean anything; it was a
 * dead icon that never did anything.
 */
export function MeetingAudioPlayer({ audioUrl, meetingTitle, audioExpiry = null }: { audioUrl: string | null; meetingTitle: string; audioExpiry?: AudioExpiryInfo | null }) {
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentMs, setCurrentMs] = useState(0);
	const [durationMs, setDurationMs] = useState(0);
	const [muted, setMuted] = useState(false);
	const [speed, setSpeed] = useState(DEFAULT_SPEED);
	const { seekRequest, reportCurrentMs } = useMeetingAudioSeek();

	// Read the persisted speed only after mount (localStorage isn't available
	// during SSR) — see loadStoredSpeed's `typeof window` guard.
	useEffect(() => {
		setSpeed(loadStoredSpeed());
	}, []);

	// Transcript rows / Ask evidence timestamps request a seek through
	// MeetingAudioSeekContext instead of touching this element directly.
	useEffect(() => {
		const audio = audioRef.current;
		if (!audio || !seekRequest) return;
		audio.currentTime = seekRequest.ms / 1000;
		setCurrentMs(seekRequest.ms);
		reportCurrentMs(seekRequest.ms);
		// `isPlaying` is driven by the element's own "play"/"pause" events
		// (see the effect below) rather than set optimistically here — if
		// play() rejects (blocked autoplay, media error), those events simply
		// never fire instead of the UI being stuck showing "playing" for an
		// element that isn't.
		void audio.play().catch(() => {});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [seekRequest]);

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;
		const onTime = () => {
			const ms = audio.currentTime * 1000;
			setCurrentMs(ms);
			// Lets a transcript row highlight itself while it's playing (see
			// useIsPlaybackActive) — deliberately NOT React state here, a
			// `timeupdate` tick several times a second would otherwise
			// re-render every consumer instead of just the one row that
			// actually changed active/inactive.
			reportCurrentMs(ms);
		};
		const onLoaded = () => setDurationMs(audio.duration * 1000 || 0);
		const onEnded = () => setIsPlaying(false);
		// Source of truth for `isPlaying` — the "play" event only fires once
		// playback has actually started, so a rejected play() (blocked
		// autoplay, media error) simply never fires it instead of leaving
		// `isPlaying` stuck true for an element that isn't actually playing.
		// This also catches playback stopping for any OTHER reason (browser
		// policy, media session, devtools) that a call site here never
		// triggered directly.
		const onPlay = () => setIsPlaying(true);
		const onPause = () => setIsPlaying(false);
		audio.addEventListener("timeupdate", onTime);
		audio.addEventListener("loadedmetadata", onLoaded);
		audio.addEventListener("ended", onEnded);
		audio.addEventListener("play", onPlay);
		audio.addEventListener("pause", onPause);
		return () => {
			audio.removeEventListener("timeupdate", onTime);
			audio.removeEventListener("loadedmetadata", onLoaded);
			audio.removeEventListener("ended", onEnded);
			audio.removeEventListener("play", onPlay);
			audio.removeEventListener("pause", onPause);
		};
	}, [audioUrl]);

	// New <audio> element mounts fresh on every audioUrl change (no ref churn
	// otherwise), so mute/speed must be re-applied here instead of relying on
	// them "sticking" from a previous element.
	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;
		audio.muted = muted;
		audio.playbackRate = speed;
	}, [audioUrl, muted, speed]);

	const togglePlay = () => {
		const audio = audioRef.current;
		if (!audio) return;
		// `isPlaying` updates via the "play"/"pause" listeners above, not
		// optimistically here — so a rejected play() leaves the button in
		// its correct (not-playing) state instead of a stuck Pause icon.
		if (audio.paused) {
			void audio.play().catch(() => {});
		} else {
			audio.pause();
		}
	};

	const toggleMute = () => {
		const audio = audioRef.current;
		const next = !muted;
		setMuted(next);
		if (audio) audio.muted = next;
	};

	const onSpeedChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const next = Number(e.target.value);
		setSpeed(next);
		localStorage.setItem(SPEED_STORAGE_KEY, String(next));
		const audio = audioRef.current;
		if (audio) audio.playbackRate = next;
	};

	const onScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
		const audio = audioRef.current;
		const nextMs = Number(e.target.value);
		setCurrentMs(nextMs);
		// Without this, the transcript row highlight (driven by
		// reportCurrentMs, not this component's own state) doesn't move until
		// the next native "timeupdate" tick, briefly showing the wrong row as
		// active right after a manual seek.
		reportCurrentMs(nextMs);
		if (audio) audio.currentTime = nextMs / 1000;
	};
	const safeTitle = meetingTitle.replace(/[\\/:*?"<>|]+/g, "_").trim() || "meeting";

	return (
		<div className="border-y border-border bg-card px-4 py-3 sm:px-6">
			{audioUrl && <audio ref={audioRef} src={audioUrl} preload="metadata" />}

			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={togglePlay}
					disabled={!audioUrl}
					aria-label={isPlaying ? "Pause" : "Play"}
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-orange text-white disabled:cursor-not-allowed disabled:opacity-50"
				>
					{isPlaying ? (
						<Pause className="h-4 w-4" />
					) : (
						<Play className="ml-0.5 h-4 w-4" />
					)}
				</button>

				<span className="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">
					{formatClock(currentMs)}
				</span>

				<input
					type="range"
					min={0}
					max={durationMs || 100}
					value={currentMs}
					onChange={onScrub}
					disabled={!audioUrl}
					className="h-1.5 flex-1 cursor-pointer rounded-full bg-muted accent-brand-orange disabled:cursor-not-allowed"
					aria-label="Seek"
				/>

				<span className="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">
					{formatClock(durationMs)}
				</span>

				<button
					type="button"
					onClick={toggleMute}
					disabled={!audioUrl}
					aria-label={muted ? "Unmute" : "Mute"}
					aria-pressed={muted}
					title={muted ? "Unmute" : "Mute"}
					className="shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
				>
					{muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
				</button>

				<select
					value={speed}
					onChange={onSpeedChange}
					disabled={!audioUrl}
					aria-label="Playback speed"
					title="Playback speed"
					className="shrink-0 rounded-md border border-border bg-card px-1.5 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
				>
					{SPEED_STEPS.map((s) => (
						<option key={s} value={s}>
							{s}x
						</option>
					))}
				</select>

				{audioUrl && !audioExpiry?.isExpired && (
					<a
						href={audioUrl}
						download={`${safeTitle}-audio`}
						aria-label="Download recording"
						title="Download recording"
						className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<Download className="h-4 w-4" />
					</a>
				)}
			</div>

			{audioUrl && audioExpiry && <AudioExpiryNote expiry={audioExpiry} className="mt-2" />}

			{!audioUrl && (
				<p className="mt-1 text-center text-xs text-muted-foreground">
					No audio file available for this meeting.
				</p>
			)}
		</div>
	);
}
