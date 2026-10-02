"use client";

import { useEffect, type MutableRefObject } from "react";
import { stopCapture } from "./captureAudio";
import type { ChunkControllerHandle, FinishedChunk } from "./chunkController";
import type { FullRecorderHandle } from "./fullRecorder";
import type { LiveTranscriptionHandle } from "../stt/liveTranscription";

const UNMOUNT_FINALIZE_TIMEOUT_MS = 5_000;

interface CleanupContext {
  tickRef: MutableRefObject<ReturnType<typeof setInterval> | null>;
  chunkControllerRef: MutableRefObject<ChunkControllerHandle | null>;
  meetingIdRef: MutableRefObject<string | null>;
  rawStreamsRef: MutableRefObject<MediaStream[]>;
  streamRef: MutableRefObject<MediaStream | null>;
  audioCtxRef: MutableRefObject<AudioContext | null>;
  abortRef: MutableRefObject<AbortController | null>;
  liveSttRef: MutableRefObject<LiveTranscriptionHandle | null>;
  releaseRecordingActivityRef: MutableRefObject<(() => void) | null>;
  persistAndQueueRef: MutableRefObject<(meeting: string, chunk: FinishedChunk) => Promise<void>>;
  fullRecorderRef: MutableRefObject<FullRecorderHandle | null>;
}

export function useMeetingRecorderCleanup(context: CleanupContext): void {
  const {
    tickRef, chunkControllerRef, meetingIdRef, rawStreamsRef, streamRef, audioCtxRef, abortRef,
    liveSttRef, releaseRecordingActivityRef, persistAndQueueRef, fullRecorderRef,
  } = context;

  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
    const controller = chunkControllerRef.current;
    const activeMeetingId = meetingIdRef.current;
    const rawStreams = rawStreamsRef.current;
    const audioContext = audioCtxRef.current;
    const abortController = abortRef.current;
    const releaseActivity = releaseRecordingActivityRef.current;
    chunkControllerRef.current = null;
    // Leaving mid-meeting: the chunks (saved locally) are the recovery copy.
    fullRecorderRef.current?.discard();
    fullRecorderRef.current = null;
    void liveSttRef.current?.close();
    liveSttRef.current = null;
    releaseRecordingActivityRef.current = null;

    const cleanupTimeout = setTimeout(() => {
      stopCapture(rawStreams, audioContext);
      audioCtxRef.current = null;
      streamRef.current = null;
      abortController?.abort();
      releaseActivity?.();
    }, UNMOUNT_FINALIZE_TIMEOUT_MS);

    void (async () => {
      try {
        const finalChunk = await controller?.stop();
        if (activeMeetingId && finalChunk) await persistAndQueueRef.current(activeMeetingId, finalChunk);
      } catch {
        // Best-effort finalize on unmount; never leave the upload loop running.
      } finally {
        clearTimeout(cleanupTimeout);
        stopCapture(rawStreams, audioContext);
        audioCtxRef.current = null;
        streamRef.current = null;
        abortController?.abort();
        releaseActivity?.();
      }
    })();
  // All captured values are stable refs, so this cleanup only runs on unmount.
  }, []);
}
