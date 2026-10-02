"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, FileText, Loader2, X } from "lucide-react";
import ProtectedRoute from "@/components/features/auth/protected-route";
import { useToolLayoutSlots } from "@/hooks/use-tool-layout-slots";
import type { Meeting } from "@/lib/meeting/types";
import { MeetingAside } from "../../components/MeetingAside";
import { Button } from "@/components/ui/button";
import { ProcessingStepper } from "./ProcessingStepper";
import { FinalizeRetryButton } from "./FinalizeRetryButton";
import { FailedMeetingRescue } from "./FailedMeetingRescue";
import {
  activityTextFor,
  buildProcessingSteps,
  currentStepLabel,
  elapsedMsFor,
  formatDurationSec,
  formatFileSize,
  overallProgressPercent,
  recordStepTimestamps,
  type StepTimestamp,
} from "./processingSteps";
import { formatClock } from "@/lib/meeting/format";
import { resolveProcessingEngine, type ProcessingEngine } from "@/lib/meeting/processing/processingEngine";
import { useMeetingProcessingRun } from "@/lib/meeting/processing/useMeetingProcessingRun";
import { ProcessingFailurePrompt } from "../../components/ProcessingFailurePrompt";
import { ProcessingEngineChoice } from "../../components/ProcessingEngineChoice";
import {
  getStoredTranscriptionMode,
  isMobileDevice,
  type MeetingTranscriptionMode,
} from "@/lib/meeting/stt/transcriptionMode";

const POLL_INTERVAL_MS = 3000;
// How long the "All done" success screen shows before navigating away —
// previously this screen just silently stopped polling and jumped straight
// to the result page the instant status flipped to READY, with no visual
// acknowledgment that processing had actually finished.
const COMPLETE_TRANSITION_MS = 900;

/**
 * "Uploading & Processing" screen (
 * "UI Reference" -> "Uploading & Processing" + section 8). Polls
 * GET /api/meeting/[meetingId] for `status` and drives the stepper from it
 * (see processingSteps.ts for the status -> step-state mapping and its
 * known limitation). Auto-redirects to the result page once READY.
 */
/** After this long without finishing, offer a way out of the run. */
const STUCK_AFTER_MS = 3 * 60_000;

export default function MeetingProcessingPage() {
  const params = useParams<{ meetingId: string }>();
  const meetingId = params?.meetingId ?? "";
  const router = useRouter();
  // Set by the "Upload Recording" flow (fileUploadPipeline.ts's
  // UPLOAD_SOURCE_QUERY) when the upload was made from a phone/tablet. The
  // chosen mode picks the engine: fast = paid API, low = free (our server on
  // a phone, see processingEngine.ts).
  const searchParams = useSearchParams();
  const isUploadSource = searchParams.get("source") === "upload";
  const modeParam = searchParams.get("mode");
  // The stored mode lives in localStorage, which doesn't exist during SSR —
  // resolve the engine in an effect after mount so hydration's first client
  // render matches the server render.
  const [engine, setEngine] = useState<ProcessingEngine | null>(null);
  // A phone recording only had paid live transcription: the user picks the
  // engine for the final pass once it has ended.
  const [needsChoice, setNeedsChoice] = useState(false);
  useEffect(() => {
    if (isMobileDevice() && !isUploadSource) {
      setNeedsChoice(true);
      return;
    }
    const mode: MeetingTranscriptionMode =
      modeParam === "low" || modeParam === "fast"
        ? modeParam
        : getStoredTranscriptionMode();
    setEngine(resolveProcessingEngine(mode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useToolLayoutSlots({ showHistory: false, aside: <MeetingAside /> });

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteDismissed, setNoteDismissed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [overallStart] = useState(() => Date.now());
  const [completing, setCompleting] = useState(false);
  const redirectedRef = useRef(false);
  // Records each step's start/end so ProcessingStepper can show a live
  // running counter (active) or a frozen "took N seconds" (complete) — see
  // processingSteps.ts's recordStepTimestamps doc comment for why mutating
  // this every render is safe here.
  const stepTimestampsRef = useRef<Record<string, StepTimestamp>>({});

  // Drives the final transcription once the meeting is finalized. The engine
  // (paid API / our server / free in-browser) follows the chosen mode and
  // device; a failure of the API or server is shown as a prompt instead of
  // silently switching engine (see useMeetingProcessingRun.ts). If the tab
  // closes first, the meeting stays PROCESSING until it is re-opened from
  // Recent Meetings, which lands back here and retries.
  const { failure, retry, abort, inOtherTab } = useMeetingProcessingRun({
    meetingId,
    // Finalize is the server barrier that proves every audio chunk is present.
    enabled: meeting?.status === "PROCESSING",
    engine,
    sttLanguage: meeting?.sttLanguage,
  });

  useEffect(() => {
    if (!meetingId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/meeting/${meetingId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const data: Meeting = await res.json();
        if (!cancelled) {
          setMeeting(data);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Couldn't load meeting status. Retrying…");
      }
    };

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [meetingId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (meeting?.status === "READY" && !redirectedRef.current) {
      redirectedRef.current = true;
      setCompleting(true);
      // The server now has everything durably (chunks/route.ts, finalize's
      // merge) — the local IndexedDB backup (lib/meeting/recorder/db.ts)
      // has done its job and would otherwise just sit there forever taking
      // up browser storage. Best-effort: a failure here doesn't block the
      // redirect, it just means this meeting's local backup lingers until
      // some later cleanup.
      void import("@/lib/meeting/recorder/db").then((m) => m.clearLocalMeetingData(meetingId)).catch(() => undefined);
      const timer = setTimeout(() => router.replace(`/meeting/${meetingId}?tab=transcript`), COMPLETE_TRANSITION_MS);
      return () => clearTimeout(timer);
    }
  }, [meeting?.status, meetingId, router]);

  const steps = meeting ? buildProcessingSteps(meeting.status, meeting.updatedAt, now) : [];
  const stepLabel = steps.length > 0 ? currentStepLabel(steps) : "";
  const progressPercent = steps.length > 0 ? overallProgressPercent(steps) : 0;

  recordStepTimestamps(steps, stepTimestampsRef.current, now);
  const enrichedSteps = steps.map((step) => {
    const elapsedMs = elapsedMsFor(step, stepTimestampsRef.current, now);
    return {
      ...step,
      elapsedMs,
      activityText: step.state === "active" ? activityTextFor(step.key, elapsedMs ?? 0) : undefined,
    };
  });
  const totalElapsedMs = now - overallStart;

  if (completing) {
    return (
      <ProtectedRoute>
        <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 px-4 py-24 text-center animate-in fade-in duration-300">
          <CheckCircle2 className="h-12 w-12 text-green-600 dark:text-green-400" />
          <h1 className="text-2xl font-semibold text-foreground">All done!</h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Opening your meeting…
          </p>
        </div>
      </ProtectedRoute>
    );
  }

  let statusDescription = "We're transcribing and analyzing your recording locally in your browser.";
  if (meeting?.status === "FAILED") {
    statusDescription = meeting.failureReason ?? "Something went wrong while processing this meeting.";
  } else if (failure) {
    statusDescription = "Processing did not finish. Choose how to continue below.";
  } else if (engine === "api") {
    statusDescription = "Transcribing with the paid transcription API, then detecting speakers.";
  } else if (engine === "server") {
    statusDescription = "Our server is transcribing your recording and detecting speakers.";
  }

  return (
    <ProtectedRoute>
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-8 px-4 py-16">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-foreground">
            {meeting?.status === "FAILED" ? "Processing failed" : "Processing your meeting"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{statusDescription}</p>
        </div>

        {error && <p className="text-sm text-muted-foreground">{error}</p>}

        {needsChoice && !engine && meeting?.status === "PROCESSING" && (
          <ProcessingEngineChoice onChoose={setEngine} />
        )}

        {failure && <ProcessingFailurePrompt failure={failure} onRetry={retry} meetingId={meetingId} />}
        {inOtherTab && !failure && (
          <p className="text-center text-sm text-muted-foreground">This recording is already being processed in another tab or window. This page will pick up if that one is closed.</p>
        )}

        {meeting?.status === "PROCESSING" && !failure && engine && totalElapsedMs > STUCK_AFTER_MS && (
          <div className="flex flex-col items-center gap-1">
            <p className="text-xs text-muted-foreground">Taking longer than expected?</p>
            <Button size="sm" variant="outline" onClick={abort}>
              Stop and choose another way
            </Button>
          </div>
        )}

        {meeting?.status === "FAILED" && <FailedMeetingRescue meetingId={meetingId} reason={meeting.failureReason} />}
        {meeting && <FinalizeRetryButton meeting={meeting} onDone={() => setMeeting({ ...meeting, status: "PROCESSING", failureReason: null })} />}

        {meeting && (
          <div className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-card-foreground">{meeting.title}</p>
              <p className="text-xs text-muted-foreground">
                {formatDurationSec(meeting.durationSec)} · {formatFileSize(meeting.fileSizeBytes)}
              </p>
            </div>
            {meeting.status !== "UPLOADING" && (
              <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                Uploaded
              </span>
            )}
          </div>
        )}

        {steps.length > 0 && !failure && (
          <div className="w-full rounded-xl border border-border bg-card px-5 py-5">
            <div className="mb-4 flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span>{stepLabel}</span>
              <span className="tabular-nums">Elapsed {formatClock(totalElapsedMs)}</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <ProcessingStepper steps={enrichedSteps} />
          </div>
        )}

        {!noteDismissed && meeting?.status !== "FAILED" && !failure && (
          <div className="flex w-full items-start gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
            <p className="flex-1">
              Keep this page open while the recording is processed. If you leave, it continues only while this tab stays open; reopen the meeting from Recent Meetings to resume it.
            </p>
            <button
              type="button"
              onClick={() => setNoteDismissed(true)}
              aria-label="Dismiss"
              className="shrink-0 rounded p-0.5 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <Link href="/meeting" className="text-sm font-medium text-primary hover:underline">
          View recent meetings
        </Link>
      </div>
    </ProtectedRoute>
  );
}
