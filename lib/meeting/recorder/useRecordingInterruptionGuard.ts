"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type { ChunkControllerHandle, FinishedChunk } from "./chunkController";
import type { CaptureError, RecorderStatus } from "./types";

const TRACK_CHECK_DELAY_MS = 1_500;
/** How long the input may stay silent before the user is told. */
const SILENCE_WARNING_MS = 45_000;
const SILENCE_SAMPLE_MS = 500;
/** RMS below this counts as silence (the signal is -1..1). */
const SILENCE_RMS = 0.002;

interface GuardContext {
  status: RecorderStatus;
  isPaused: boolean;
  streamRef: MutableRefObject<MediaStream | null>;
  rawStreamsRef: MutableRefObject<MediaStream[]>;
  audioCtxRef: MutableRefObject<AudioContext | null>;
  chunkControllerRef: MutableRefObject<ChunkControllerHandle | null>;
  meetingIdRef: MutableRefObject<string | null>;
  persistAndQueue: (meeting: string, chunk: FinishedChunk) => Promise<void>;
  setError: (value: CaptureError | null) => void;
}

/** Protects a live recording from the page being hidden, frozen or closed.
 *
 *  - When the page is hidden (tab switch, phone locked, app backgrounded) the
 *    chunk in progress is saved immediately: a frozen or killed page never
 *    gets another chance to hand it over.
 *  - When the page closes for real, the chunk in progress is finished and
 *    stored best-effort; the next visit offers to upload and finalize it.
 *  - When the page comes back and the microphone stream is dead or silent
 *    (phone browsers pause capture in the background), the user is told that
 *    part of the recording is missing instead of finding out afterwards.
 *  - When the system mutes the microphone (a phone call, another app taking
 *    the mic) or suspends the audio engine, the user is told right then.
 *  - When nothing but silence arrives for a while (a shared tab without sound,
 *    a muted mic), the user is told while there is still time to fix it. */
export function useRecordingInterruptionGuard(context: GuardContext): void {
  const { status, isPaused, streamRef, rawStreamsRef, audioCtxRef, chunkControllerRef, meetingIdRef, persistAndQueue, setError } = context;
  const live = useRef({ status, isPaused });
  live.current = { status, isPaused };
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    const recording = () => live.current.status === "recording";

    const onVisibility = () => {
      if (!recording()) return;
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        chunkControllerRef.current?.flushNow();
        return;
      }
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenAt === null || live.current.isPaused) return;
      const hiddenSec = Math.round((Date.now() - hiddenAt) / 1000);
      // Give a resumed track a moment to unmute before judging it.
      setTimeout(() => {
        if (!recording()) return;
        const tracks = streamRef.current?.getAudioTracks() ?? [];
        const interrupted = tracks.length === 0 || tracks.every((track) => track.readyState === "ended" || track.muted);
        if (interrupted) {
          setError({
            reason: "audio-ended",
            message: `Recording was interrupted while this tab was in the background (about ${hiddenSec}s). Some audio may be missing. Keep this tab open and in front while recording.`,
          });
        }
      }, TRACK_CHECK_DELAY_MS);
    };

    const onPageHide = (event: PageTransitionEvent) => {
      if (event.persisted || !recording()) return;
      const controller = chunkControllerRef.current;
      const id = meetingIdRef.current;
      if (!controller || !id) return;
      chunkControllerRef.current = null;
      void controller.stop().then((chunk) => (chunk ? persistAndQueue(id, chunk) : undefined)).catch(() => undefined);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [chunkControllerRef, meetingIdRef, persistAndQueue, setError, streamRef]);

  // The system (not the user) can mute the microphone or suspend audio: a
  // phone call, Siri, another app using the mic. Say so as it happens.
  useEffect(() => {
    if (status !== "recording") return;
    const tracks = rawStreamsRef.current.flatMap((raw) => raw.getAudioTracks());
    let warned = false;
    const warn = (message: string) => {
      warned = true;
      setError({ reason: "audio-ended", message });
    };
    const onMute = () => warn("The audio input was muted by the system (for example a phone call or another app using the microphone). Audio is not being recorded until it returns.");
    const onUnmute = () => {
      if (!warned) return;
      warned = false;
      setError(null);
    };
    tracks.forEach((track) => {
      track.addEventListener("mute", onMute);
      track.addEventListener("unmute", onUnmute);
    });
    const audioCtx = audioCtxRef.current;
    const onState = () => {
      if (!audioCtx || audioCtx.state === "running" || audioCtx.state === "closed") return;
      // "suspended" / "interrupted": try to bring the audio engine back first.
      void audioCtx.resume().catch(() => warn("The audio engine was paused by the browser and could not restart. Tap the screen, or end the meeting to keep what was recorded."));
    };
    audioCtx?.addEventListener("statechange", onState);
    return () => {
      tracks.forEach((track) => {
        track.removeEventListener("mute", onMute);
        track.removeEventListener("unmute", onUnmute);
      });
      audioCtx?.removeEventListener("statechange", onState);
    };
  }, [audioCtxRef, rawStreamsRef, setError, status]);

  // Silence watchdog: a recording that is all silence looks exactly like a
  // working one, and is only discovered after the meeting is over.
  useEffect(() => {
    if (status !== "recording") return;
    const audioCtx = audioCtxRef.current;
    const stream = streamRef.current;
    if (!audioCtx || !stream || stream.getAudioTracks().length === 0) return;
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let lastSoundAt = Date.now();
    let warned = false;
    const timer = setInterval(() => {
      if (live.current.isPaused || document.visibilityState === "hidden") {
        lastSoundAt = Date.now();
        return;
      }
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      if (Math.sqrt(sum / data.length) > SILENCE_RMS) {
        lastSoundAt = Date.now();
        if (warned) {
          warned = false;
          setError(null);
        }
      } else if (!warned && Date.now() - lastSoundAt >= SILENCE_WARNING_MS) {
        warned = true;
        setError({
          reason: "silent-audio",
          message: "No sound has been detected for 45 seconds. If you are sharing a tab, make sure \"Share tab audio\" is ticked; also check that the microphone is allowed and not muted.",
        });
      }
    }, SILENCE_SAMPLE_MS);
    return () => {
      clearInterval(timer);
      try { source.disconnect(); } catch { /* already gone */ }
    };
  }, [audioCtxRef, setError, status, streamRef]);
}
