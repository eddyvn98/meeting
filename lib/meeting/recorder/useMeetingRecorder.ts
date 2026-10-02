"use client";

/**
 * lib/meeting/recorder/useMeetingRecorder.ts
 * State/orchestration facade for meeting recording.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { putChunkBlob, putChunkMeta } from "./db";
import type { ChunkControllerHandle, FinishedChunk } from "./chunkController";
import type { FullRecorderHandle } from "./fullRecorder";
import { uploadChunkWithRetry } from "./uploadQueue";
import type { CaptureError, LocalChunkMeta, MeetingRecorderState, MeetingRecorderActions, RecorderStatus } from "./types";
import { startLiveTranscription, type LiveSttStatus, type LiveTranscriptionHandle } from "../stt/liveTranscription";
import type { STTSegment } from "../stt/types";
import { getStoredSttLang } from "../sttLanguages";
import { DEFAULT_TRANSCRIPTION_MODE, getRecordingTranscriptionMode, type MeetingTranscriptionMode } from "../stt/transcriptionMode";
import {
  getStoredLiveTranscriptEnabled,
  setStoredLiveTranscriptEnabled,
  getStoredLiveTranslationEnabled,
  setStoredLiveTranslationEnabled,
} from "./liveTranscriptOption";
import { DEFAULT_TRANSLATE_LANG, getStoredTranslateLang, setStoredTranslateLang } from "../translateLanguages";
import { useMeetingRecorderCancel } from "./useMeetingRecorderCancel";
import { useMeetingRecorderControls } from "./useMeetingRecorderControls";
import { useMeetingRecorderCleanup } from "./useMeetingRecorderCleanup";
import { useRecordingInterruptionGuard } from "./useRecordingInterruptionGuard";

export type { MeetingRecorderState, MeetingRecorderActions };

export function useMeetingRecorder(): MeetingRecorderState & MeetingRecorderActions {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState<CaptureError | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [chunkCount, setChunkCount] = useState(0);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [marks, setMarks] = useState<number[]>([]);
  const [liveSttStatus, setLiveSttStatus] = useState<LiveSttStatus>("starting");
  const [liveTranscript, setLiveTranscript] = useState<STTSegment[]>([]);
  const [liveTranslations, setLiveTranslations] = useState<Record<number, string>>({});
  const [liveProcessedUntilSec, setLiveProcessedUntilSec] = useState(0);
  const [liveMessage, setLiveMessage] = useState<string | undefined>();
  const [transcriptionMode, setTranscriptionModeState] = useState<MeetingTranscriptionMode>(DEFAULT_TRANSCRIPTION_MODE);
  const [liveTranscriptEnabled, setLiveTranscriptEnabledState] = useState(true);
  const [liveTranslationEnabled, setLiveTranslationEnabledState] = useState(false);
  const [targetTranslateLanguage, setTargetTranslateLanguageState] = useState(DEFAULT_TRANSLATE_LANG);

  const transcriptionModeRef = useRef<MeetingTranscriptionMode>(DEFAULT_TRANSCRIPTION_MODE);
  const liveTranscriptEnabledRef = useRef(true);
  const liveTranslationEnabledRef = useRef(false);
  const targetTranslateLanguageRef = useRef(DEFAULT_TRANSLATE_LANG);
  const rawStreamsRef = useRef<MediaStream[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chunkControllerRef = useRef<ChunkControllerHandle | null>(null);
  const fullRecorderRef = useRef<FullRecorderHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);
  const titleRef = useRef("");
  const marksRef = useRef<number[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveSttRef = useRef<LiveTranscriptionHandle | null>(null);
  const meetingIdRef = useRef<string | null>(null);
  const pausedAtRef = useRef<number | null>(null);
  const pausedDurationMsRef = useRef(0);
  const persistAndQueueRef = useRef<(meeting: string, chunk: FinishedChunk) => Promise<void>>(async () => undefined);
  const releaseRecordingActivityRef = useRef<(() => void) | null>(null);
  const queuedChunkIdsRef = useRef(new Set<string>());

  useEffect(() => {
    const storedMode = getRecordingTranscriptionMode();
    const storedLiveTranscript = getStoredLiveTranscriptEnabled();
    const storedLiveTranslation = getStoredLiveTranslationEnabled();
    const storedTranslateLang = getStoredTranslateLang();
    transcriptionModeRef.current = storedMode;
    setTranscriptionModeState(storedMode);
    setLiveTranscriptEnabledState(storedLiveTranscript);
    setLiveTranslationEnabledState(storedLiveTranslation);
    setTargetTranslateLanguageState(storedTranslateLang);
    liveTranscriptEnabledRef.current = storedLiveTranscript;
    liveTranslationEnabledRef.current = storedLiveTranslation;
    targetTranslateLanguageRef.current = storedTranslateLang;
  }, []);

  const initLiveStt = useCallback((id: string, mode: MeetingTranscriptionMode) => {
    setLiveSttStatus("starting");
    return startLiveTranscription((snapshot) => {
      setLiveSttStatus(snapshot.status);
      setLiveTranscript(snapshot.segments);
      setLiveProcessedUntilSec(snapshot.processedUntilSec);
      setLiveMessage(snapshot.message || undefined);
      if (snapshot.translations) setLiveTranslations(snapshot.translations);
    }, {
      language: getStoredSttLang(),
      mode,
      meetingId: id,
      enableTranslation: liveTranslationEnabledRef.current,
      targetLanguage: targetTranslateLanguageRef.current,
    });
  }, []);

  const persistAndQueue = useCallback(async (meeting: string, chunk: FinishedChunk): Promise<void> => {
    const id = `${meeting}:${chunk.chunkIndex}`;
    if (queuedChunkIdsRef.current.has(id)) return;
    queuedChunkIdsRef.current.add(id);
    const meta: LocalChunkMeta = {
      id, meetingId: meeting, chunkIndex: chunk.chunkIndex,
      startTimeMs: chunk.startTimeMs, endTimeMs: chunk.endTimeMs,
      mimeType: chunk.mimeType, sizeBytes: chunk.blob.size,
      localState: "stored", uploadState: "pending", uploadAttempts: 0, createdAt: Date.now(),
    };
    // If the local backup fails (full disk, private mode), the audio is still
    // in memory right now: upload it from there instead of dropping it.
    let storedLocally = true;
    try {
      await putChunkBlob({ id, blob: chunk.blob });
      await putChunkMeta(meta);
    } catch {
      storedLocally = false;
    }
    setChunkCount((count) => count + 1);
    const offsetMs = startedAtRef.current > 0 ? Math.max(0, chunk.startTimeMs - startedAtRef.current) : 0;
    if (liveTranscriptEnabledRef.current) liveSttRef.current?.enqueue(chunk.blob, offsetMs);
    void uploadChunkWithRetry(meta, (updated) => {
      if (updated.uploadState === "uploaded") setUploadedCount((count) => count + 1);
    }, abortRef.current?.signal, storedLocally ? undefined : chunk.blob).catch(() => undefined);
  }, []);

  useEffect(() => { persistAndQueueRef.current = persistAndQueue; }, [persistAndQueue]);

  useMeetingRecorderCleanup({
    tickRef, chunkControllerRef, meetingIdRef, rawStreamsRef, streamRef, audioCtxRef, abortRef,
    liveSttRef, releaseRecordingActivityRef, persistAndQueueRef, fullRecorderRef,
  });

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (status !== "recording" && status !== "stopping" && status !== "finalizing") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [status]);

  useRecordingInterruptionGuard({ status, isPaused, streamRef, rawStreamsRef, audioCtxRef, chunkControllerRef, meetingIdRef, persistAndQueue, setError });

  const setLiveTranslationEnabled = useCallback((enabled: boolean) => {
    liveTranslationEnabledRef.current = enabled;
    setLiveTranslationEnabledState(enabled);
    setStoredLiveTranslationEnabled(enabled);
    liveSttRef.current?.setTranslationOptions({ enabled, targetLanguage: targetTranslateLanguageRef.current });
  }, []);

  const setTargetTranslateLanguage = useCallback((language: string) => {
    targetTranslateLanguageRef.current = language;
    setStoredTranslateLang(language);
    setTargetTranslateLanguageState(language);
    liveSttRef.current?.setTranslationOptions({ enabled: liveTranslationEnabledRef.current, targetLanguage: language });
  }, []);

  const setLiveTranscriptEnabled = useCallback((enabled: boolean) => {
    liveTranscriptEnabledRef.current = enabled;
    setLiveTranscriptEnabledState(enabled);
    setStoredLiveTranscriptEnabled(enabled);
    // The live session stays open while switched off, so the text and
    // translations already shown are kept; new chunks just aren't sent to it
    // (see persistAndQueue). It is closed when the meeting ends.
    if (!enabled) {
      setLiveSttStatus("unavailable");
    } else if (status === "recording" && meetingId) {
      if (liveSttRef.current) {
        liveSttRef.current.markResumed(Math.max(0, (Date.now() - startedAtRef.current) / 1000));
        setLiveSttStatus("listening");
      } else {
        liveSttRef.current = initLiveStt(meetingId, transcriptionModeRef.current);
      }
    }
  }, [initLiveStt, meetingId, status]);

  const controls = useMeetingRecorderControls({
    status, meetingId, chunkCount, isPaused, setStatus, setError, setMeetingId, setIsPaused,
    setElapsedMs, setTranscriptionModeState, setMarks, setLiveSttStatus,
    setLiveTranscript, setLiveTranslations, setLiveProcessedUntilSec,
    transcriptionModeRef, liveTranscriptEnabledRef, rawStreamsRef, streamRef, audioCtxRef,
    chunkControllerRef, fullRecorderRef, abortRef, startedAtRef, titleRef, marksRef, tickRef, liveSttRef,
    meetingIdRef, pausedAtRef, pausedDurationMsRef, releaseRecordingActivityRef,
    queuedChunkIdsRef, persistAndQueue, initLiveStt,
  });

  const cancelRecording = useMeetingRecorderCancel({
    status, meetingId, setStatus, setIsPaused, tickRef, abortRef, chunkControllerRef, fullRecorderRef, liveSttRef,
    rawStreamsRef, audioCtxRef, streamRef, meetingIdRef, releaseRecordingActivityRef,
  });

  return {
    status, error, meetingId, elapsedMs, chunkCount, uploadedCount, marks,
    streamRef, liveSttStatus, liveTranscript, liveTranslations, liveProcessedUntilSec,
    liveMessage, transcriptionMode, isPaused, liveTranscriptEnabled, liveTranslationEnabled,
    targetTranslateLanguage, ...controls, cancelRecording, setLiveTranscriptEnabled, setLiveTranslationEnabled,
    setTargetTranslateLanguage,
  };
}
