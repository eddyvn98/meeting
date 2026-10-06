"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Sparkles, Users } from "lucide-react";
import type { MeetingDetail } from "@/lib/meeting/types";
import { retryMeetingDiarization } from "@/lib/meeting/processing/retryMeetingDiarization";
import { canRetryPostprocess } from "@/lib/meeting/processing/postprocessRecovery";

export function MeetingPostprocessRecovery({
  detail,
  onRefresh,
}: {
  detail: MeetingDetail;
  onRefresh: (detail: MeetingDetail) => void;
}) {
  const [busy, setBusy] = useState<"diarization" | "enrichment" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const isOwner = detail.accessRole === "owner";

  useEffect(() => {
    if (
      detail.diarizationStatus !== "RUNNING" &&
      detail.enrichmentStatus !== "RUNNING"
    ) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [detail.diarizationStatus, detail.enrichmentStatus]);

  const updatedAtMs = useMemo(() => Date.parse(detail.updatedAt), [detail.updatedAt]);

  const canRetryDiarization =
    isOwner &&
    Boolean(detail.audioUrl) &&
    detail.transcriptSegments.length > 0 &&
    canRetryPostprocess(detail.diarizationStatus, updatedAtMs, now);

  const canRetryEnrichment =
    isOwner &&
    detail.transcriptSegments.length > 0 &&
    !detail.summary &&
    canRetryPostprocess(detail.enrichmentStatus, updatedAtMs, now);

  const showDiarization =
    detail.diarizationStatus === "PENDING" ||
    detail.diarizationStatus === "RUNNING" ||
    detail.diarizationStatus === "FAILED";
  const showEnrichment =
    !detail.summary &&
    (detail.enrichmentStatus === "PENDING" ||
      detail.enrichmentStatus === "RUNNING" ||
      detail.enrichmentStatus === "FAILED");

  if (!showDiarization && !showEnrichment) return null;

  const refresh = async () => {
    const response = await fetch(
      `/api/meeting/${encodeURIComponent(detail.id)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return;
    onRefresh((await response.json()) as MeetingDetail);
  };

  const retryDiarization = async () => {
    if (!canRetryDiarization || busy) return;
    setBusy("diarization");
    try {
      await retryMeetingDiarization(detail.id, detail.transcriptSegments);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const retryEnrichment = async () => {
    if (!canRetryEnrichment || busy) return;
    setBusy("enrichment");
    try {
      await fetch(`/api/meeting/${encodeURIComponent(detail.id)}/enrich`, {
        method: "POST",
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-4 mt-3 space-y-2 sm:mx-6">
      {showDiarization && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {detail.diarizationStatus === "FAILED"
                  ? "Speaker detection needs a retry"
                  : detail.diarizationStatus === "RUNNING"
                    ? "Identifying speakers"
                    : "Speaker detection is pending"}
              </p>
              {detail.diarizationError && (
                <p className="truncate text-xs text-muted-foreground">
                  {detail.diarizationError}
                </p>
              )}
            </div>
          </div>
          {canRetryDiarization && (
            <button
              type="button"
              onClick={() => void retryDiarization()}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              {busy === "diarization" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Retry speakers
            </button>
          )}
        </div>
      )}

      {showEnrichment && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {detail.enrichmentStatus === "FAILED"
                  ? "Overview generation needs a retry"
                  : detail.enrichmentStatus === "RUNNING"
                    ? "Generating Overview"
                    : "Overview generation is pending"}
              </p>
              {detail.enrichmentError && (
                <p className="truncate text-xs text-muted-foreground">
                  {detail.enrichmentError}
                </p>
              )}
            </div>
          </div>
          {canRetryEnrichment && (
            <button
              type="button"
              onClick={() => void retryEnrichment()}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              {busy === "enrichment" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Retry Overview
            </button>
          )}
        </div>
      )}
    </div>
  );
}
