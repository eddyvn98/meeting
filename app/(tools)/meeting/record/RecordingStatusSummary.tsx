"use client";

import { AlertTriangle, Cloud, Cpu, Zap } from "lucide-react";
import type { MeetingTranscriptionMode } from "@/lib/meeting/stt/transcriptionMode";

export interface RecordingStatusSummaryProps {
  elapsedLabel: string;
  isRecording: boolean;
  isPaused: boolean;
  transcriptionMode: MeetingTranscriptionMode;
  uploadedCount: number;
  chunkCount: number;
  hasWarning: boolean;
  warningLabel?: string;
}

/**
 * Inline status row (timer, mode, upload progress, warning) shown inside the
 * mobile recording controls bar so the whole state fits in one bar.
 */
export function RecordingStatusSummary({
  elapsedLabel,
  isRecording,
  isPaused,
  transcriptionMode,
  uploadedCount,
  chunkCount,
  hasWarning,
  warningLabel,
}: RecordingStatusSummaryProps) {
  const modeShortLabel = transcriptionMode === "fast" ? "fast" : "low";

  return (
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${
            isRecording && !isPaused ? "animate-pulse bg-red-500" : "bg-muted-foreground"
          }`}
        />
        <span className="font-mono text-base font-medium tabular-nums text-foreground">{elapsedLabel}</span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {transcriptionMode === "fast" ? (
            <Zap className="h-3 w-3 fill-amber-500 text-amber-500" />
          ) : (
            <Cpu className="h-3 w-3 text-emerald-500" />
          )}
          {modeShortLabel}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
          <Cloud className="h-3 w-3" />
          {uploadedCount}/{chunkCount}
        </span>
        {hasWarning && (
          <span
            className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
            title={warningLabel ?? "Recording needs attention"}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
          </span>
        )}
      </span>
  );
}
