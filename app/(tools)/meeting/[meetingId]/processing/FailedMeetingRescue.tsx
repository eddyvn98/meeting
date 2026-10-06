"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AudioRescuePanel } from "../../components/AudioRescuePanel";
import { useOpenRecordingOnly } from "../../components/useOpenRecordingOnly";

export function FailedMeetingRescue({ meetingId, reason }: { meetingId: string; reason: string | null }) {
  const recordingOnly = useOpenRecordingOnly(meetingId);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const retryable = /processing (?:stalled|timed out)/i.test(reason ?? "");

  const retryProcessing = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const response = await fetch(`/api/meeting/${encodeURIComponent(meetingId)}/reprocess`, {
        method: "POST",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Processing could not be restarted.");
      window.location.reload();
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "Processing could not be restarted.");
      setRetrying(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4">
      <p className="text-sm font-medium text-foreground">Your recording is not lost</p>
      <p className="text-xs text-muted-foreground">
        The original audio is still stored. You can retry processing, open the recording without a transcript, or download it.
      </p>
      <div className="flex flex-wrap gap-2">
        {retryable && (
          <Button size="sm" disabled={retrying} onClick={() => void retryProcessing()}>
            {retrying ? "Restarting…" : "Retry processing"}
          </Button>
        )}
        <Button
          size="sm"
          variant={retryable ? "outline" : "default"}
          disabled={recordingOnly.busy}
          onClick={() => void recordingOnly.open(reason ?? undefined)}
        >
          {recordingOnly.busy ? "Opening…" : "Open the recording"}
        </Button>
      </div>
      {(retryError || recordingOnly.error) && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {retryError ?? recordingOnly.error}
        </p>
      )}
      <AudioRescuePanel meetingId={meetingId} />
    </div>
  );
}
