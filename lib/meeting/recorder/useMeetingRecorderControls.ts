"use client";

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { putSession } from "./db";
import { pickSupportedMimeType, startChunking, CHUNK_DURATION_LOW_MS, CHUNK_DURATION_FAST_MS, type ChunkControllerHandle, type FinishedChunk } from "./chunkController";
import { startCapture, stopCapture, takePreparedCapture } from "./captureAudio";
import { startFullRecorder, uploadFullAudio, type FullRecorderHandle } from "./fullRecorder";
import { waitForChunksUploaded, createMeetingRecord, WAIT_FOR_UPLOADS_TIMEOUT_MS } from "./meetingRecorderApi";
import type { CaptureError, CaptureSource, RecorderStatus } from "./types";
import type { LiveSttStatus, LiveTranscriptionHandle } from "../stt/liveTranscription";
import type { STTSegment } from "../stt/types";
import { getStoredSttLang } from "../sttLanguages";
import { getRecordingTranscriptionMode, setStoredTranscriptionMode, type MeetingTranscriptionMode } from "../stt/transcriptionMode";
import { acquireMeetingActivity } from "../meetingActivityLock";

const FINALIZE_ATTEMPTS = 3;
const FINALIZE_RETRY_DELAY_MS = 2_000;

const finalizeMeeting = (meetingId: string, expectedChunkCount: number) =>
  fetch(`/api/meeting/${meetingId}/finalize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedChunkCount }) });

export interface MeetingRecorderControlsContext {
  status: RecorderStatus;
  meetingId: string | null;
  chunkCount: number;
  isPaused: boolean;
  setStatus: (value: RecorderStatus) => void;
  setError: (value: CaptureError | null) => void;
  setMeetingId: (value: string | null) => void;
  setIsPaused: (value: boolean) => void;
  setMarks: Dispatch<SetStateAction<number[]>>;
  setLiveSttStatus: (value: LiveSttStatus) => void;
  setLiveTranscript: Dispatch<SetStateAction<STTSegment[]>>;
  setLiveTranslations: Dispatch<SetStateAction<Record<number, string>>>;
  setLiveProcessedUntilSec: Dispatch<SetStateAction<number>>;
  setElapsedMs: Dispatch<SetStateAction<number>>;
  setTranscriptionModeState: Dispatch<SetStateAction<MeetingTranscriptionMode>>;
  transcriptionModeRef: MutableRefObject<MeetingTranscriptionMode>;
  liveTranscriptEnabledRef: MutableRefObject<boolean>;
  rawStreamsRef: MutableRefObject<MediaStream[]>;
  streamRef: MutableRefObject<MediaStream | null>;
  audioCtxRef: MutableRefObject<AudioContext | null>;
  chunkControllerRef: MutableRefObject<ChunkControllerHandle | null>;
  fullRecorderRef: MutableRefObject<FullRecorderHandle | null>;
  abortRef: MutableRefObject<AbortController | null>;
  startedAtRef: MutableRefObject<number>;
  titleRef: MutableRefObject<string>;
  marksRef: MutableRefObject<number[]>;
  tickRef: MutableRefObject<ReturnType<typeof setInterval> | null>;
  liveSttRef: MutableRefObject<LiveTranscriptionHandle | null>;
  meetingIdRef: MutableRefObject<string | null>;
  pausedAtRef: MutableRefObject<number | null>;
  pausedDurationMsRef: MutableRefObject<number>;
  releaseRecordingActivityRef: MutableRefObject<(() => void) | null>;
  queuedChunkIdsRef: MutableRefObject<Set<string>>;
  persistAndQueue: (meeting: string, chunk: FinishedChunk) => Promise<void>;
  initLiveStt: (meetingId: string, mode: MeetingTranscriptionMode) => LiveTranscriptionHandle;
}

export function useMeetingRecorderControls(context: MeetingRecorderControlsContext) {
  const {
    status, meetingId, chunkCount, isPaused, setStatus, setError, setMeetingId, setIsPaused,
    setElapsedMs, setTranscriptionModeState, setMarks, setLiveSttStatus,
    setLiveTranscript, setLiveTranslations, setLiveProcessedUntilSec, transcriptionModeRef, liveTranscriptEnabledRef,
    rawStreamsRef, streamRef, audioCtxRef, chunkControllerRef, fullRecorderRef, abortRef, startedAtRef, titleRef,
    marksRef, tickRef, liveSttRef, meetingIdRef, pausedAtRef, pausedDurationMsRef,
    releaseRecordingActivityRef, queuedChunkIdsRef, persistAndQueue, initLiveStt,
  } = context;

  const setTranscriptionMode = useCallback((mode: MeetingTranscriptionMode) => {
    transcriptionModeRef.current = mode;
    setStoredTranscriptionMode(mode);
    setTranscriptionModeState(mode);
  }, [setTranscriptionModeState, transcriptionModeRef]);

  const start = useCallback(async (title: string, source: CaptureSource = "display") => {
    const activeMode = getRecordingTranscriptionMode();
    transcriptionModeRef.current = activeMode;
    setTranscriptionModeState(activeMode);
    setStatus("requesting-permission");
    setError(null);
    const result = takePreparedCapture() ?? (await startCapture(source));
    if (result.error) {
      setError(result.error);
      setStatus("error");
      return;
    }

    const sttLanguage = getStoredSttLang();
    let id: string;
    try {
      id = await createMeetingRecord(title, sttLanguage);
    } catch {
      stopCapture(result.rawStreams, result.audioCtx);
      setError({ reason: "unknown", message: "Failed to create the meeting record on the server." });
      setStatus("error");
      return;
    }

    setMeetingId(id);
    meetingIdRef.current = id;
    rawStreamsRef.current = result.rawStreams;
    streamRef.current = result.stream;
    audioCtxRef.current = result.audioCtx;
    abortRef.current = new AbortController();
    startedAtRef.current = Date.now();
    pausedAtRef.current = null;
    pausedDurationMsRef.current = 0;
    setIsPaused(false);
    titleRef.current = title;
    marksRef.current = [];
    queuedChunkIdsRef.current.clear();
    setMarks([]);
    setLiveTranscript([]);
    setLiveTranslations({});
    setLiveProcessedUntilSec(0);

    await putSession({ meetingId: id, title, startedAt: startedAtRef.current, endedAt: null, status: "recording", chunkCount: 0, marks: [] });

    // A continuous copy for listening; the chunks below stay the live feed and the fallback.
    fullRecorderRef.current = startFullRecorder(result.stream, pickSupportedMimeType());

    const chunkDurationMs = activeMode === "fast" ? CHUNK_DURATION_FAST_MS : CHUNK_DURATION_LOW_MS;
    chunkControllerRef.current = startChunking(
      result.stream,
      (chunk) => persistAndQueue(id, chunk),
      pickSupportedMimeType(),
      chunkDurationMs,
      () => setError({ reason: "audio-ended", message: "Audio input stopped while recording. Check microphone permission and reconnect the input." }),
    );

    if (liveTranscriptEnabledRef.current) {
      liveSttRef.current = initLiveStt(id, activeMode);
    } else setLiveSttStatus("unavailable");
    tickRef.current = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 250);
    releaseRecordingActivityRef.current?.();
    releaseRecordingActivityRef.current = acquireMeetingActivity("recording");
    setStatus("recording");
  }, [abortRef, audioCtxRef, chunkControllerRef, fullRecorderRef, initLiveStt, liveSttRef, liveTranscriptEnabledRef, meetingIdRef, marksRef, pausedAtRef, persistAndQueue, queuedChunkIdsRef, rawStreamsRef, releaseRecordingActivityRef, setElapsedMs, setError, setIsPaused, setLiveProcessedUntilSec, setLiveTranscript, setLiveTranslations, setMeetingId, setMarks, setStatus, setLiveSttStatus, setTranscriptionModeState, startedAtRef, streamRef, tickRef, titleRef, transcriptionModeRef]);

  const markImportant = useCallback(() => {
    if (status !== "recording" || isPaused) return;
    const timestamp = Date.now() - startedAtRef.current - pausedDurationMsRef.current;
    const nextMarks = [...marksRef.current, timestamp];
    marksRef.current = nextMarks;
    setMarks(nextMarks);
  }, [isPaused, marksRef, pausedDurationMsRef, setMarks, startedAtRef, status]);

  const pause = useCallback(() => {
    if (status !== "recording" || isPaused) return;
    if (!chunkControllerRef.current?.pause()) {
      setError({ reason: "unknown", message: "Recording is changing audio segments. Try pausing again in a moment." });
      return;
    }
    fullRecorderRef.current?.pause();
    liveSttRef.current?.pause();
    setError(null);
    pausedAtRef.current = Date.now();
    if (tickRef.current) clearInterval(tickRef.current);
    setElapsedMs(Date.now() - startedAtRef.current - pausedDurationMsRef.current);
    setIsPaused(true);
  }, [chunkControllerRef, fullRecorderRef, isPaused, liveSttRef, pausedAtRef, pausedDurationMsRef, setElapsedMs, setError, setIsPaused, startedAtRef, status, tickRef]);

  const resume = useCallback(() => {
    if (status !== "recording" || !isPaused) return;
    const pausedAt = pausedAtRef.current;
    if (!(chunkControllerRef.current?.resume() ?? false)) {
      setError({ reason: "unknown", message: "Recording could not resume. Try again or end the meeting." });
      return;
    }
    fullRecorderRef.current?.resume();
    liveSttRef.current?.resume();
    setError(null);
    if (pausedAt !== null) pausedDurationMsRef.current += Math.max(0, Date.now() - pausedAt);
    pausedAtRef.current = null;
    tickRef.current = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current - pausedDurationMsRef.current), 250);
    setElapsedMs(Date.now() - startedAtRef.current - pausedDurationMsRef.current);
    setIsPaused(false);
  }, [chunkControllerRef, fullRecorderRef, isPaused, liveSttRef, pausedAtRef, pausedDurationMsRef, setElapsedMs, setError, setIsPaused, startedAtRef, status, tickRef]);

  const endMeeting = useCallback(async () => {
    if (!meetingId || status !== "recording") return;
    setStatus("stopping");
    if (tickRef.current) clearInterval(tickRef.current);
    try {
      const controller = chunkControllerRef.current;
      const finalChunk = await controller?.stop();
      chunkControllerRef.current = null;
      const fullRecording = await fullRecorderRef.current?.stop().catch(() => null);
      fullRecorderRef.current = null;
      if (pausedAtRef.current !== null) {
        pausedDurationMsRef.current += Math.max(0, Date.now() - pausedAtRef.current);
        pausedAtRef.current = null;
      }
      setIsPaused(false);
      if (finalChunk) await persistAndQueue(meetingId, finalChunk);
      void liveSttRef.current?.close();
      liveSttRef.current = null;
      stopCapture(rawStreamsRef.current, audioCtxRef.current);
      audioCtxRef.current = null;
      streamRef.current = null;
      await putSession({ meetingId, title: titleRef.current, startedAt: startedAtRef.current, endedAt: Date.now(), status: "ended", chunkCount, marks: marksRef.current });

      setStatus("finalizing");
      // Count from the chunks actually handed to persistAndQueue (a ref, updated
      // synchronously), not from React state: a chunk that finished a moment
      // before End Meeting may not be in `chunkCount` yet, and an undercount
      // would let the server finalize without the tail of the recording.
      const expectedChunkCount = [...queuedChunkIdsRef.current].reduce((max, id) => Math.max(max, Number(id.slice(id.lastIndexOf(":") + 1)) + 1), 0);
      if (expectedChunkCount === 0) {
        setError({ reason: "unknown", message: "No audio was captured, so there is nothing to save. Check the audio input and try again." });
        setStatus("stopped");
        meetingIdRef.current = null;
        return;
      }
      // Send the continuous recording while the chunks finish uploading. If it
      // does not arrive, or the server cannot read it, finalize merges the chunks.
      const fullUpload = fullRecording ? uploadFullAudio(meetingId, fullRecording) : Promise.resolve(false);
      const chunksUploaded = await waitForChunksUploaded(meetingId, expectedChunkCount, WAIT_FOR_UPLOADS_TIMEOUT_MS);
      const fullUploaded = await fullUpload;
      if (!chunksUploaded && !fullUploaded) {
        setError({ reason: "unknown", message: "Some audio is still uploading. It remains saved locally; reopen Meeting Home to resume it." });
        setStatus("stopped");
        meetingIdRef.current = null;
        return;
      }
      // A server hiccup (merge, database) is retried a few times; the server
      // leaves the meeting open for exactly this, and the audio stays saved.
      let response = await finalizeMeeting(meetingId, expectedChunkCount);
      for (let attempt = 1; attempt < FINALIZE_ATTEMPTS && response.status >= 500; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, FINALIZE_RETRY_DELAY_MS * attempt));
        response = await finalizeMeeting(meetingId, expectedChunkCount);
      }
      if (!response.ok) {
        setError({ reason: "unknown", message: "The server is still waiting for the complete recording. Reopen Meeting Home to resume it." });
        setStatus("stopped");
        meetingIdRef.current = null;
        return;
      }
      setStatus("processing");
      meetingIdRef.current = null;
    } catch (error) {
      setError({ reason: "unknown", message: error instanceof Error ? error.message : "The meeting could not be completed. Reopen Meeting Home to recover it." });
      setStatus("stopped");
      meetingIdRef.current = null;
    } finally {
      void liveSttRef.current?.close();
      liveSttRef.current = null;
      stopCapture(rawStreamsRef.current, audioCtxRef.current);
      audioCtxRef.current = null;
      streamRef.current = null;
      releaseRecordingActivityRef.current?.();
      releaseRecordingActivityRef.current = null;
    }
  }, [audioCtxRef, chunkCount, chunkControllerRef, fullRecorderRef, liveSttRef, meetingId, meetingIdRef, marksRef, pausedAtRef, pausedDurationMsRef, persistAndQueue, rawStreamsRef, releaseRecordingActivityRef, setError, setIsPaused, setStatus, startedAtRef, status, streamRef, tickRef, titleRef]);

  return { start, markImportant, pause, resume, endMeeting, setTranscriptionMode };
}
