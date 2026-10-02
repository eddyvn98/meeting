"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { freeProcessingEngine, type ProcessingEngine } from "@/lib/meeting/processing/processingEngine";
import type { ProcessingFailure } from "@/lib/meeting/processing/useMeetingProcessingRun";
import { useOpenRecordingOnly } from "./useOpenRecordingOnly";

interface ProcessingFailurePromptProps {
  failure: ProcessingFailure;
  /** Enables the way out: skip transcription and open the recording. */
  meetingId?: string | null;
  onRetry: (engine: ProcessingEngine) => void;
}

/** Asks what to do after the paid API or our server failed to process a
 *  recording. Nothing is retried on a different engine without a click. */
export function ProcessingFailurePrompt({ failure, onRetry, meetingId = null }: ProcessingFailurePromptProps) {
  const recordingOnly = useOpenRecordingOnly(meetingId);
  const isApiFailure = failure.engine === "api";
  const isServerFailure = failure.engine === "server";
  const freeEngine = freeProcessingEngine();

  return (
    <div
      role="alert"
      className="w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/40"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            {isApiFailure
              ? "The paid API couldn't process this recording"
              : isServerFailure
                ? "Our server couldn't process this recording"
                : "Processing in this browser failed"}
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-300">{failure.reason}</p>
          <p className="text-xs text-amber-800 dark:text-amber-300">
            {isApiFailure
              ? "Try the API again, or process it for free instead (slower)."
              : isServerFailure
                ? "You can retry on our server, or use the paid API instead. The paid API uses transcription credits."
                : "You can try again, or use the paid API instead. The paid API uses transcription credits."}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {isApiFailure ? (
          <>
            <Button size="sm" onClick={() => onRetry("api")}>
              Try the API again
            </Button>
            <Button size="sm" variant="outline" onClick={() => onRetry(freeEngine)}>
              {freeEngine === "server" ? "Process on our server (free)" : "Process in this browser (free)"}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => onRetry("api")}>
              Use the paid API
            </Button>
            <Button size="sm" variant="outline" onClick={() => onRetry(failure.engine)}>
              {isServerFailure ? "Try our server again" : "Try again"}
            </Button>
          </>
        )}
      </div>
      {meetingId && (
        <div className="mt-3 border-t border-amber-200 pt-3 dark:border-amber-900">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Not working out? Skip transcription for now. You get an empty Overview where you can play and download the recording, and you can retry transcription later.
          </p>
          <Button size="sm" variant="outline" className="mt-2" disabled={recordingOnly.busy} onClick={() => void recordingOnly.open(failure.reason)}>
            {recordingOnly.busy ? "Opening…" : "Skip transcription and open the recording"}
          </Button>
          {recordingOnly.error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{recordingOnly.error}</p>}
        </div>
      )}
    </div>
  );
}
