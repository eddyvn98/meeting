"use client";

import { useCallback } from "react";
import { clearLocalMeetingData } from "./db";
import { stopCapture } from "./captureAudio";
import type { MeetingRecorderControlsContext } from "./useMeetingRecorderControls";

type CancelContext = Pick<
  MeetingRecorderControlsContext,
  | "status" | "meetingId" | "setStatus" | "setIsPaused" | "tickRef" | "abortRef" | "chunkControllerRef" | "fullRecorderRef"
  | "liveSttRef" | "rawStreamsRef" | "audioCtxRef" | "streamRef" | "meetingIdRef" | "releaseRecordingActivityRef"
>;

/**
 * Cancel an in-progress recording: stop capture, stop uploading, and throw
 * away everything recorded so far (local backup and the server-side meeting).
 * Nothing is kept, so it must only be called after the user confirmed.
 */
export function useMeetingRecorderCancel(context: CancelContext) {
  const {
    status, meetingId, setStatus, setIsPaused, tickRef, abortRef, chunkControllerRef, fullRecorderRef,
    liveSttRef, rawStreamsRef, audioCtxRef, streamRef, meetingIdRef, releaseRecordingActivityRef,
  } = context;

  return useCallback(async () => {
    if (!meetingId || status !== "recording") return;
    setStatus("stopping");
    if (tickRef.current) clearInterval(tickRef.current);
    abortRef.current?.abort();
    try {
      await chunkControllerRef.current?.stop();
    } catch {
      // The recording is being discarded; a failed final chunk does not matter.
    }
    chunkControllerRef.current = null;
    fullRecorderRef.current?.discard();
    fullRecorderRef.current = null;
    void liveSttRef.current?.close();
    liveSttRef.current = null;
    stopCapture(rawStreamsRef.current, audioCtxRef.current);
    audioCtxRef.current = null;
    streamRef.current = null;
    releaseRecordingActivityRef.current?.();
    releaseRecordingActivityRef.current = null;
    meetingIdRef.current = null;
    setIsPaused(false);
    await clearLocalMeetingData(meetingId).catch(() => undefined);
    await fetch(`/api/meeting/${encodeURIComponent(meetingId)}`, { method: "DELETE" }).catch(() => undefined);
    setStatus("cancelled");
  }, [abortRef, audioCtxRef, chunkControllerRef, fullRecorderRef, liveSttRef, meetingId, meetingIdRef, rawStreamsRef, releaseRecordingActivityRef, setIsPaused, setStatus, status, streamRef, tickRef]);
}
