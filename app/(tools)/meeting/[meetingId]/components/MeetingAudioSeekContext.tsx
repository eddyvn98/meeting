"use client";

import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type ReactNode,
} from "react";

interface SeekRequest {
	ms: number;
	nonce: number;
	/** False for a "just play a sample, don't move my place" seek (e.g. the
	 *  Speakers panel's preview button) — MeetingTranscriptSegmentRow reads
	 *  this to skip its own scrollIntoView for that one activation, so
	 *  sampling a speaker's voice doesn't yank the transcript list away from
	 *  the rename controls the user is about to use. Defaults to true so
	 *  every other caller keeps today's karaoke-style auto-follow. */
	autoScroll: boolean;
}

interface MeetingAudioSeekContextValue {
	seekRequest: SeekRequest | null;
	seekTo: (ms: number, opts?: { autoScroll?: boolean }) => void;
	/** Pub-sub for the live playhead position (ms), kept OUT of React state
	 *  so a `timeupdate` tick (several times a second) doesn't force every
	 *  consumer to re-render — see useIsPlaybackActive below, which only
	 *  actually re-renders a transcript row when ITS OWN active/inactive
	 *  boolean flips, not on every tick. */
	subscribeCurrentMs: (cb: () => void) => () => void;
	getCurrentMs: () => number;
	reportCurrentMs: (ms: number) => void;
}

const MeetingAudioSeekContext = createContext<MeetingAudioSeekContextValue | null>(null);

/**
 * Shared state between the sticky `MeetingAudioPlayer` and the Transcript/Ask
 * tabs, in both directions:
 *  - `seekTo`/`seekRequest`: a transcript row or Ask evidence timestamp jumps
 *    the shared player without page.tsx lifting the player's entire state.
 *  - `reportCurrentMs`/`subscribeCurrentMs`/`getCurrentMs`: the player
 *    reports its live playhead position so a transcript row can highlight
 *    itself while it's the one currently playing (useIsPlaybackActive).
 * The player still owns all real playback state (`isPlaying`, the `<audio>`
 * element itself) locally — this context only carries requests/position.
 */
export function MeetingAudioSeekProvider({ children }: { children: ReactNode }) {
	const [seekRequest, setSeekRequest] = useState<SeekRequest | null>(null);
	const currentMsRef = useRef(0);
	const listenersRef = useRef(new Set<() => void>());

	const seekTo = useCallback((ms: number, opts?: { autoScroll?: boolean }) => {
		setSeekRequest({ ms, nonce: Date.now() + Math.random(), autoScroll: opts?.autoScroll ?? true });
	}, []);

	const subscribeCurrentMs = useCallback((cb: () => void) => {
		listenersRef.current.add(cb);
		return () => listenersRef.current.delete(cb);
	}, []);
	const getCurrentMs = useCallback(() => currentMsRef.current, []);
	const reportCurrentMs = useCallback((ms: number) => {
		currentMsRef.current = ms;
		for (const cb of listenersRef.current) cb();
	}, []);

	// Stable identity across ticks (reportCurrentMs mutates a ref, it never
	// changes `seekRequest`) — so this Provider re-rendering on a seek never
	// happens on every timeupdate tick, only on an actual seek.
	const value = useMemo(
		() => ({ seekRequest, seekTo, subscribeCurrentMs, getCurrentMs, reportCurrentMs }),
		[seekRequest, seekTo, subscribeCurrentMs, getCurrentMs, reportCurrentMs],
	);

	return (
		<MeetingAudioSeekContext.Provider value={value}>
			{children}
		</MeetingAudioSeekContext.Provider>
	);
}

export function useMeetingAudioSeek(): MeetingAudioSeekContextValue {
	const ctx = useContext(MeetingAudioSeekContext);
	if (!ctx) {
		throw new Error("useMeetingAudioSeek must be used within MeetingAudioSeekProvider");
	}
	return ctx;
}

/** True while the shared player's current position falls within
 *  [startMs, endMs) — used by MeetingTranscriptSegmentRow.tsx to highlight
 *  whichever segment is currently playing. Built on useSyncExternalStore so
 *  a `timeupdate` tick only re-renders THIS row when its own boolean
 *  actually flips, not on every tick for every row. */
export function useIsPlaybackActive(startMs: number, endMs: number): boolean {
	const { subscribeCurrentMs, getCurrentMs } = useMeetingAudioSeek();
	return useSyncExternalStore(
		subscribeCurrentMs,
		() => {
			const ms = getCurrentMs();
			return ms >= startMs && ms < endMs;
		},
		() => false,
	);
}
