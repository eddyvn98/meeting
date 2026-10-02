"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Flag, Pause, Play, Square } from "lucide-react";
import type { MeetingTranscriptionMode } from "@/lib/meeting/stt/transcriptionMode";
import { formatElapsed } from "./RecordingControlCard";
import { RecordingStatusSummary } from "./RecordingStatusSummary";
import { AudioWaveform } from "./AudioWaveform";
import { CancelRecordingButton } from "./CancelRecordingButton";

interface MobileRecordingActionsProps {
  isRecording: boolean;
  isPaused: boolean;
  isProcessing: boolean;
  processingComplete: boolean;
  processingFailed: boolean;
  ending: boolean;
  keepScreenAwake: boolean;
  wakeLockSupported: boolean;
  wakeLockActive: boolean;
  errorMessage?: string;
  elapsedMs: number;
  stream: MediaStream | null;
  onCancelRecording: () => void;
  transcriptionMode: MeetingTranscriptionMode;
  uploadedCount: number;
  chunkCount: number;
  hasWarning: boolean;
  warningLabel?: string;
  onKeepScreenAwakeChange: (enabled: boolean) => void;
  onMarkImportant: () => void;
  onPause: () => void;
  onResume: () => void;
  onEndMeeting: () => Promise<void>;
  onOpenResult: () => void;
}

export function MobileRecordingActions({
  isRecording,
  isPaused,
  isProcessing,
  processingComplete,
  processingFailed,
  ending,
  keepScreenAwake,
  wakeLockSupported,
  wakeLockActive,
  onKeepScreenAwakeChange,
  onMarkImportant,
  onPause,
  onResume,
  onEndMeeting,
  onOpenResult,
  errorMessage,
  elapsedMs,
  stream,
  onCancelRecording,
  transcriptionMode,
  uploadedCount,
  chunkCount,
  hasWarning,
  warningLabel,
}: MobileRecordingActionsProps) {
  const [expanded, setExpanded] = useState(false);
  const [endArmed, setEndArmed] = useState(false);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (endTimerRef.current) clearTimeout(endTimerRef.current);
  }, []);
  if (!isRecording && !(isProcessing && (processingComplete || processingFailed))) return null;

  const canOpenResult = isProcessing && (processingComplete || processingFailed);
  const armOrEndMeeting = () => {
    if (endArmed) {
      if (endTimerRef.current) clearTimeout(endTimerRef.current);
      setEndArmed(false);
      void onEndMeeting();
      return;
    }
    setEndArmed(true);
    endTimerRef.current = setTimeout(() => setEndArmed(false), 4000);
  };
  const summary = canOpenResult ? (
    <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
      <span className="h-2 w-2 rounded-full bg-muted-foreground" />
      Meeting controls
    </span>
  ) : (
    <RecordingStatusSummary
      elapsedLabel={formatElapsed(elapsedMs)}
      isRecording={isRecording}
      isPaused={isPaused}
      transcriptionMode={transcriptionMode}
      uploadedCount={uploadedCount}
      chunkCount={chunkCount}
      hasWarning={hasWarning}
      warningLabel={warningLabel}
    />
  );
  const waveform = isRecording && !isPaused ? <AudioWaveform stream={stream} className="mt-1 h-7 w-full" /> : null;

  if (!expanded) {
    return (
      <button
        type="button"
        aria-expanded="false"
        aria-label="Show recording controls"
        onClick={() => setExpanded(true)}
        className="sticky top-2 z-20 flex w-full flex-col rounded-xl border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur sm:hidden"
      >
        <span className="flex w-full items-center justify-between gap-2">
          {summary}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </span>
        {waveform}
      </button>
    );
  }

  return (
    <div className="sticky top-2 z-20 w-full rounded-xl border border-border bg-card/95 p-2 shadow-lg backdrop-blur sm:hidden">
      <div className="mb-2 px-1">
        <div className="flex items-center justify-between gap-2">
          {summary}
          <button type="button" aria-expanded="true" aria-label="Hide recording controls" onClick={() => setExpanded(false)} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <ChevronUp className="h-4 w-4" />
          </button>
        </div>
        {waveform}
      </div>
      {isRecording && (
        <div className="grid grid-cols-3 gap-2">
          <button type="button" aria-label="Mark important" onClick={onMarkImportant} className="flex min-h-11 items-center justify-center gap-1 rounded-lg border border-border px-1 text-[11px] font-semibold text-foreground">
            <Flag className="h-4 w-4 text-primary" /> Mark
          </button>
          <button type="button" aria-label={isPaused ? "Resume recording" : "Pause recording"} disabled={ending} onClick={isPaused ? onResume : onPause} className="flex min-h-11 items-center justify-center gap-1 rounded-lg border border-border px-1 text-[11px] font-semibold text-foreground">
            {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />} {isPaused ? "Resume" : "Pause"}
          </button>
          <button type="button" aria-label={endArmed ? "Tap again to end meeting" : "End meeting"} disabled={ending} onClick={armOrEndMeeting} className="flex min-h-11 items-center justify-center gap-1 rounded-lg bg-primary px-1 text-[11px] font-semibold text-white">
            <Square className="h-4 w-4 fill-white" /> {endArmed ? "Tap again" : "End"}
          </button>
        </div>
      )}
      {isRecording && (
        <div className="mt-2 flex justify-center">
          <CancelRecordingButton
            disabled={ending}
            onConfirm={onCancelRecording}
            className="px-2 py-1 text-xs font-medium text-muted-foreground hover:text-red-600 disabled:opacity-50"
          />
        </div>
      )}
      {errorMessage && <p className="mt-2 rounded-lg bg-red-500/10 px-2.5 py-2 text-[11px] text-red-700 dark:text-red-300">{errorMessage}</p>}
      {canOpenResult && (
        <button type="button" aria-label="Open meeting result" onClick={onOpenResult} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-2 text-xs font-semibold text-white">
          <ExternalLink className="h-4 w-4" /> Open meeting result
        </button>
      )}
      {isRecording && (
        <label className="mt-2 flex items-start gap-2 rounded-lg border border-border/70 bg-muted/20 px-2.5 py-2 text-xs text-foreground">
          <input type="checkbox" checked={keepScreenAwake} onChange={(event) => onKeepScreenAwakeChange(event.target.checked)} className="mt-0.5 h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary" />
          <span>
            <span className="block font-medium">Keep screen awake</span>
            <span className="block text-[11px] text-muted-foreground">
              {wakeLockSupported
                ? (wakeLockActive ? "Screen wake lock is active." : "The browser may release it when hidden.")
                : "Not supported by this browser. Locking the screen may pause recording."}
            </span>
          </span>
        </label>
      )}
    </div>
  );
}
