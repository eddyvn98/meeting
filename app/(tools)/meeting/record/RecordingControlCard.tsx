"use client";

import { ExternalLink, Flag, Pause, Play, Square, Zap, Cpu, Mic } from "lucide-react";
import { AudioWaveform } from "./AudioWaveform";
import { CancelRecordingButton } from "./CancelRecordingButton";
import { useIsMobile } from "@/hooks/use-mobile";
import { ProcessingStepper } from "@/app/(tools)/meeting/[meetingId]/processing/ProcessingStepper";
import type { ProcessingStep } from "@/app/(tools)/meeting/[meetingId]/processing/processingSteps";
import { TRANSCRIPTION_MODES, type MeetingTranscriptionMode } from "@/lib/meeting/stt/transcriptionMode";
import type { CaptureError } from "@/lib/meeting/recorder/types";

export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export interface RecordingControlCardProps {
  title: string;
  transcriptionMode: MeetingTranscriptionMode;
  elapsedMs: number;
  stream: MediaStream | null;
  uploadedCount: number;
  chunkCount: number;
  marksCount: number;
  isRecording: boolean;
  isPaused: boolean;
  isPreparing: boolean;
  isFinalizing: boolean;
  isProcessing: boolean;
  processingComplete: boolean;
  processingFailed: boolean;
  processingSteps: ProcessingStep[];
  processingStepLabel: string;
  processingProgressPercent: number;
  ending: boolean;
  onMarkImportant: () => void;
  onPause: () => void;
  onResume: () => void;
  onEndMeeting: () => Promise<void>;
  onCancelRecording: () => void;
  onOpenResult: () => void;
  error?: CaptureError | null;
}

export function RecordingControlCard({
  title,
  transcriptionMode,
  elapsedMs,
  stream,
  uploadedCount,
  chunkCount,
  marksCount,
  isRecording,
  isPaused,
  isPreparing,
  isFinalizing,
  isProcessing,
  processingComplete,
  processingFailed,
  processingSteps,
  processingStepLabel,
  processingProgressPercent,
  ending,
  onMarkImportant,
  onPause,
  onResume,
  onEndMeeting,
  onCancelRecording,
  onOpenResult,
  error,
}: RecordingControlCardProps) {
  const currentModeOption = TRANSCRIPTION_MODES.find((m) => m.mode === transcriptionMode);

  // While recording, mobile shows the status in MobileRecordingActions' single
  // bar, so this card is desktop-only in that state.
  const hiddenOnMobile = isRecording;
  const isMobile = useIsMobile();

  let statusLabel = "Stopped";
  if (isPreparing) statusLabel = "Preparing...";
  else if (isPaused) statusLabel = "Paused";
  else if (isRecording) statusLabel = "Recording";
  else if (isFinalizing) statusLabel = "Uploading...";
  else if (isProcessing) {
    if (processingFailed) statusLabel = "Processing failed";
    else if (processingComplete) statusLabel = "Ready";
    else statusLabel = "Processing...";
  }

  let endLabel = "End Meeting";
  if (processingFailed) endLabel = "Open meeting details";
  else if (isProcessing) endLabel = processingComplete ? "Open meeting result" : "Processing meeting...";
  else if (isFinalizing) endLabel = "Uploading remaining audio...";
  else if (ending) endLabel = "Ending...";

  let waveformMessage = "Waiting for audio signal...";
  if (isPaused) waveformMessage = "Recording paused";
  else if (processingFailed) waveformMessage = "Processing failed — open meeting details";
  else if (isProcessing && processingComplete) waveformMessage = "Processing complete — live transcript remains open";
  else if (isProcessing) waveformMessage = "Recording ended — processing audio...";

  return (
    <div className={`w-full flex-col gap-2 ${hiddenOnMobile ? "hidden sm:flex" : "flex"}`}>
          <div className="flex w-full flex-col items-center gap-5 rounded-2xl border border-border bg-card p-5 shadow-sm text-center">
            {/* Mode Badge */}
            <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
              {transcriptionMode === "fast" ? (
                <Zap className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
              ) : (
                <Cpu className="h-3.5 w-3.5 text-emerald-500" />
              )}
              <span>
                Mode: <strong>{currentModeOption?.label ?? transcriptionMode}</strong> — {currentModeOption?.description ?? ""}
              </span>
            </div>

      {/* Meeting Title */}
      <h3 className="text-base font-semibold text-foreground line-clamp-2 px-1" title={title}>
        {title}
      </h3>

      {/* Status & Big Timer */}
      <div className="flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${isRecording && !isPaused ? "animate-pulse bg-red-500" : "bg-muted-foreground"}`}
          />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {statusLabel}
          </span>
        </div>
        <span className="font-mono text-4xl font-bold tracking-tight text-foreground">
          {formatElapsed(elapsedMs)}
        </span>
      </div>

      {/* Audio Waveform / Processing Pipeline */}
      <div className="flex w-full justify-center py-1">
        {isProcessing ? (
          <div className="w-full rounded-xl border border-border bg-muted/20 p-3 text-left">
            <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>{processingStepLabel}</span>
              <span className="tabular-nums">{processingProgressPercent}%</span>
            </div>
            <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${processingProgressPercent}%` }}
              />
            </div>
            <ProcessingStepper steps={processingSteps} />
          </div>
        ) : isRecording && !isPaused && !(hiddenOnMobile && isMobile) ? (
          <AudioWaveform stream={stream} />
        ) : (
          <div className="h-12 w-64 rounded-lg bg-muted/40 flex items-center justify-center text-xs text-muted-foreground">
            {waveformMessage}
          </div>
        )}
      </div>

      {/* Backup Status Info */}
      <div className="space-y-1 text-xs text-muted-foreground border-t border-border/80 pt-3 w-full">
        <p>{isProcessing ? "Recording ended. Audio is being processed." : "Audio is being saved locally and uploaded automatically."}</p>
        <p className="font-medium text-foreground">
          {uploadedCount} / {chunkCount} chunks backed up
        </p>
        {marksCount > 0 && (
          <p className="font-medium text-primary">
            {marksCount} moment(s) marked
          </p>
        )}
      </div>

      {/* Error display if any */}
      {error && (
        <div className="w-full rounded-lg bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {error.message}
        </div>
      )}

      {/* Action Buttons */}
      <div className="hidden w-full flex-col gap-2.5 pt-1 sm:flex">
        {!isProcessing && <button
          type="button"
          disabled={!isRecording || isPaused}
          onClick={onMarkImportant}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        >
          <Flag className="h-4 w-4 text-primary" />
          <span>Mark important</span>
        </button>}

        {!isProcessing && <button
          type="button"
          disabled={!isRecording || ending}
          onClick={isPaused ? onResume : onPause}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        >
          {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          <span>{isPaused ? "Resume recording" : "Pause recording"}</span>
        </button>}

        {isProcessing && !processingComplete && !processingFailed ? (
          <p className="rounded-xl border border-border bg-muted/30 px-4 py-2.5 text-center text-xs text-muted-foreground">
            Processing continues while the live transcript stays available.
          </p>
        ) : <button
          type="button"
          disabled={(!isRecording && !processingComplete && !processingFailed) || ending}
          onClick={processingComplete || processingFailed ? onOpenResult : onEndMeeting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-sm"
        >
          {processingComplete || processingFailed ? <ExternalLink className="h-4 w-4" /> : <Square className="h-4 w-4 fill-white" />}
          <span>{endLabel}</span>
        </button>}
        {isRecording && (
          <CancelRecordingButton
            disabled={ending}
            onConfirm={onCancelRecording}
            className="py-1 text-xs font-medium text-muted-foreground hover:text-red-600 disabled:opacity-50"
          />
        )}
      </div>

      {isPreparing && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Mic className="h-3 w-3 animate-spin" />
          Waiting for audio-sharing permission...
        </p>
      )}
          </div>
    </div>
  );
}
