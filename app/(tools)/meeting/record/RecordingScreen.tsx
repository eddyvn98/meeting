"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMeetingRecorder } from "@/lib/meeting/recorder/useMeetingRecorder";
import { hasPreparedCapture } from "@/lib/meeting/recorder/captureAudio";
import { useScreenWakeLock } from "@/lib/meeting/recorder/useScreenWakeLock";
import { useIsMobile } from "@/hooks/use-mobile";
import { LiveTranscriptPanel } from "./LiveTranscriptPanel";
import { hasUploadBacklog } from "@/lib/meeting/recorder/recordingCardCollapse";
import { MobileRecordingActions } from "./MobileRecordingActions";
import { RecordingControlCard } from "./RecordingControlCard";
import { MeetingRecoveryBanner } from "../components/MeetingRecoveryBanner";
import { resolveProcessingEngine, type ProcessingEngine } from "@/lib/meeting/processing/processingEngine";
import { ProcessingEscape } from "./ProcessingEscape";
import { useMeetingProcessingRun } from "@/lib/meeting/processing/useMeetingProcessingRun";
import { ProcessingFailurePrompt } from "../components/ProcessingFailurePrompt";
import { ProcessingEngineChoice } from "../components/ProcessingEngineChoice";
import { warmSttModelsInBackground } from "@/lib/meeting/stt/preloadStt";
import { getRecordingTranscriptionMode } from "@/lib/meeting/stt/transcriptionMode";
import {
  buildProcessingSteps,
  currentStepLabel,
  overallProgressPercent,
} from "@/app/(tools)/meeting/[meetingId]/processing/processingSteps";

const ERROR_COPY: Record<string, string> = {
  "permission-denied": "Permission to capture audio was denied. Grant access and try again.",
  "not-supported": "This browser does not support microphone or tab audio capture. Try a modern browser.",
  "no-audio-track": "No audio track was provided. Check the selected audio source and try again.",
  "silent-audio": "No audio signal was detected — this device/environment may not expose audio to the browser.",
  "audio-ended": "Audio input stopped while recording. Check microphone permission and reconnect the input.",
  unknown: "Something went wrong while starting the recording.",
};

const SAFARI_HINT_REASONS = new Set(["permission-denied", "no-audio-track", "silent-audio"]);

function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua);
}

export function RecordingScreen({ title }: { title: string }) {
  const recorder = useMeetingRecorder();
  const isMobile = useIsMobile();
  const [ending, setEnding] = useState(false);
  const [keepScreenAwake, setKeepScreenAwake] = useState(true);
  const [processingSnapshot, setProcessingSnapshot] = useState<{ status?: string; updatedAt?: string } | null>(null);
  const startedRef = useRef(false);
  const isRecording = recorder.status === "recording";
  const router = useRouter();
  const wakeLock = useScreenWakeLock(isMobile && isRecording && !recorder.isPaused && keepScreenAwake);

  // Local ("low") transcription only: start downloading the browser models in
  // the background as soon as this screen opens, so they are usually warm by
  // the time they are needed. "fast" (cloud) never loads them.
  useEffect(() => {
    if (recorder.transcriptionMode === "low" && getRecordingTranscriptionMode() === "low") warmSttModelsInBackground();
  }, [recorder.transcriptionMode]);

  // On a phone live transcription is paid-only, so after "End meeting" we stop
  // and let the user pick the engine for the final pass.
  const [chosenEngine, setChosenEngine] = useState<ProcessingEngine | null>(null);

  // Final pass after "End meeting": the paid API (desktop fast), our server
  // (phone recordings) or the free in-browser model. A failure of the API or
  // server is shown as a prompt instead of silently switching engine.
  const { failure: processingFailure, retry: retryProcessing, abort: abortProcessing, inOtherTab } = useMeetingProcessingRun({
    meetingId: recorder.meetingId,
    enabled: recorder.status === "processing",
    engine: isMobile ? chosenEngine : resolveProcessingEngine(recorder.transcriptionMode),
  });

  useEffect(() => {
    if (recorder.status !== "processing" || !recorder.meetingId) {
      setProcessingSnapshot(null);
      return;
    }
    if (processingSnapshot?.status === "READY" || processingSnapshot?.status === "FAILED") return;

    const meetingId = recorder.meetingId;
    let cancelled = false;

    const pollProcessingStatus = async () => {
      try {
        const response = await fetch(`/api/meeting/${encodeURIComponent(meetingId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { status?: string; updatedAt?: string };
        if (cancelled) return;
        setProcessingSnapshot(data);
      } catch {
        // Keep the live view available; the next poll retries automatically.
      }
    };

    void pollProcessingStatus();
    const intervalId = window.setInterval(() => void pollProcessingStatus(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [processingSnapshot, recorder.meetingId, recorder.status]);

  useEffect(() => {
    if (startedRef.current) return;
    if (!hasPreparedCapture()) return;
    startedRef.current = true;
    void recorder.start(title, isMobile ? "microphone" : "display");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  useEffect(() => {
    if (recorder.status === "cancelled") router.replace("/meeting");
  }, [recorder.status, router]);

  if (!hasPreparedCapture() && !startedRef.current && recorder.status === "idle") {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
        <MeetingRecoveryBanner />
        <h1 className="text-lg font-semibold text-foreground">Ready to Record</h1>
        <p className="text-sm text-muted-foreground">
          No active audio stream detected. Click below to start audio capture or return to Meeting Home.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              startedRef.current = true;
              void recorder.start(title, isMobile ? "microphone" : "display");
            }}
            className="rounded-md bg-brand-orange px-4 py-2 text-sm font-medium text-white hover:bg-brand-orange/90"
          >
            Start Recording
          </button>
          <a
            href="/meeting"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            Back to Meeting Home
          </a>
        </div>
      </div>
    );
  }

  if (recorder.status === "error") {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
        <h1 className="text-lg font-semibold text-foreground">Recording could not start</h1>
        <p className="text-sm text-muted-foreground">
          {recorder.error ? ERROR_COPY[recorder.error.reason] ?? recorder.error.message : ERROR_COPY.unknown}
        </p>
        {recorder.error && SAFARI_HINT_REASONS.has(recorder.error.reason) && isSafari() && (
          <span className="rounded-full bg-brand-orange/10 px-3 py-1 text-xs font-medium text-brand-orange">
            Tip: recording works best in Chrome — try switching browsers
          </span>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-brand-orange px-4 py-2 text-sm font-medium text-white hover:bg-brand-orange/90"
        >
          Try again
        </button>
      </div>
    );
  }

  const isPreparing = recorder.status === "idle" || recorder.status === "requesting-permission";
  const isFinalizing = recorder.status === "finalizing";
  const isProcessing = recorder.status === "processing";
  const processingStatus = processingSnapshot?.status ?? "PROCESSING";
  const processingSteps = isProcessing
    ? buildProcessingSteps(processingStatus, processingSnapshot?.updatedAt ?? new Date().toISOString(), Date.now())
    : [];
  const processingStepLabel = currentStepLabel(processingSteps);
  const processingProgressPercent = overallProgressPercent(processingSteps);
  const processingComplete = processingStatus === "READY";
  const processingFailed = processingStatus === "FAILED" || Boolean(processingFailure);
  const openMeetingResult = () => {
    if (!recorder.meetingId) return;
    window.open(`/meeting/${encodeURIComponent(recorder.meetingId)}?tab=transcript`, "_blank", "noopener,noreferrer");
  };
  const hasRecordingWarning = Boolean(recorder.error) || hasUploadBacklog(recorder.uploadedCount, recorder.chunkCount);
  const recordingWarningLabel = recorder.error?.message ?? (hasRecordingWarning ? "Chunk backup is falling behind" : undefined);
  const liveLagSec = Math.max(0, recorder.elapsedMs / 1000 - recorder.liveProcessedUntilSec);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">
      <MobileRecordingActions
        isRecording={isRecording}
        isPaused={recorder.isPaused}
        isProcessing={isProcessing}
        processingComplete={processingComplete}
        processingFailed={processingFailed}
        ending={ending}
        keepScreenAwake={keepScreenAwake}
        wakeLockSupported={wakeLock.supported}
        wakeLockActive={wakeLock.active}
        errorMessage={recorder.error?.reason === "audio-ended" ? recorder.error.message : undefined}
        elapsedMs={recorder.elapsedMs}
        stream={recorder.streamRef.current}
        onCancelRecording={() => void recorder.cancelRecording()}
        transcriptionMode={recorder.transcriptionMode}
        uploadedCount={recorder.uploadedCount}
        chunkCount={recorder.chunkCount}
        hasWarning={hasRecordingWarning}
        warningLabel={recordingWarningLabel}
        onKeepScreenAwakeChange={setKeepScreenAwake}
        onMarkImportant={recorder.markImportant}
        onPause={recorder.pause}
        onResume={recorder.resume}
        onEndMeeting={async () => {
          setEnding(true);
          try {
            await recorder.endMeeting();
          } finally {
            setEnding(false);
          }
        }}
        onOpenResult={openMeetingResult}
      />
      {isMobile && recorder.status === "processing" && !chosenEngine && (
        <div className="mb-4">
          <ProcessingEngineChoice onChoose={setChosenEngine} />
        </div>
      )}
      {recorder.status === "processing" && !processingFailure && (isMobile ? chosenEngine : true) && (
        <>
          {inOtherTab && <p className="mb-4 text-sm text-muted-foreground">This recording is already being processed in another tab or window.</p>}
          <ProcessingEscape onAbort={abortProcessing} />
        </>
      )}
      {processingFailure && (
        <div className="mb-4">
          <ProcessingFailurePrompt failure={processingFailure} onRetry={retryProcessing} meetingId={recorder.meetingId} />
        </div>
      )}
      <div className="flex flex-col lg:flex-row items-start gap-6">
        {/* Left/Main expanded area: 2-Column Live Transcript & Translation */}
        <div className="flex-1 w-full min-w-0">
          <LiveTranscriptPanel
            transcript={recorder.liveTranscript}
            translations={recorder.liveTranslations}
            translationEnabled={recorder.liveTranslationEnabled}
            onTranslationEnabledChange={recorder.setLiveTranslationEnabled}
            targetLanguage={recorder.targetTranslateLanguage}
            onTargetLanguageChange={recorder.setTargetTranslateLanguage}
            liveSttStatus={recorder.liveSttStatus}
            liveMessage={recorder.liveMessage}
            liveLagSec={liveLagSec}
            liveTranscriptEnabled={recorder.liveTranscriptEnabled}
            onLiveTranscriptEnabledChange={recorder.setLiveTranscriptEnabled}
          />
        </div>

        {/* Right Corner: Compact Recording Control Card (Control Cluster) */}
        <div className="w-full lg:w-80 xl:w-96 shrink-0 lg:sticky lg:top-6">
          <RecordingControlCard
            title={title}
            transcriptionMode={recorder.transcriptionMode}
            elapsedMs={recorder.elapsedMs}
            stream={recorder.streamRef.current}
            uploadedCount={recorder.uploadedCount}
            chunkCount={recorder.chunkCount}
            marksCount={recorder.marks.length}
            isRecording={isRecording}
            isPaused={recorder.isPaused}
            isPreparing={isPreparing}
            isFinalizing={isFinalizing}
            isProcessing={isProcessing}
            processingComplete={processingComplete}
            processingFailed={processingFailed}
            processingSteps={processingSteps}
            processingStepLabel={processingStepLabel}
            processingProgressPercent={processingProgressPercent}
            onOpenResult={openMeetingResult}
            onCancelRecording={() => void recorder.cancelRecording()}
            ending={ending}
            onMarkImportant={recorder.markImportant}
            onPause={recorder.pause}
            onResume={recorder.resume}
            onEndMeeting={async () => {
              setEnding(true);
              try {
                await recorder.endMeeting();
              } finally {
                setEnding(false);
              }
            }}
            error={recorder.error}
          />
        </div>
      </div>
    </div>
  );
}
