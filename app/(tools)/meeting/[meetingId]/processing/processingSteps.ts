/**
 * app/(tools)/meeting/[meetingId]/processing/processingSteps.ts
 *
 * Pure helpers that turn a polled `Meeting` (from lib/meeting/types.ts) into
 * the 5-step stepper model shown on the Processing screen.
 *
 * IMPORTANT ambiguity: `MeetingStatus` (lib/meeting/types.ts) is only
 * `UPLOADING | PROCESSING | READY | FAILED` — there is no granular
 * "transcribing / diarizing / summarizing" field on the Meeting record. The
 * UI spec ("Uploading & Processing")
 * calls for 5 distinct steps. Until the STT-provider agent (lib/meeting/stt/)
 * and the data-model agent land a real per-step status, this derives a
 * best-effort visual progression from elapsed time while status stays
 * PROCESSING, so the user always sees forward motion instead of one step
 * stuck "active" for the whole job. Replace `estimateActiveSubStep` with a
 * real field (e.g. `Meeting.processingStep`) once that lands — see the
 * report note for step 4 of the Meeting flow.
 */

export type StepState = "complete" | "active" | "pending";

export interface ProcessingStep {
  key: string;
  label: string;
  description: string;
  state: StepState;
  /** Time spent on this step so far — keeps counting up while `state` is
   *  "active", frozen at its final value once "complete"; undefined while
   *  "pending" (hasn't started yet). See recordStepTimestamps. */
  elapsedMs?: number;
  /** Rotating "what's happening right now" text, only meaningful for the
   *  active step — see activityTextFor's doc comment for why this is
   *  cosmetic rather than a real per-step signal. */
  activityText?: string;
}

/** Sub-steps that happen while MeetingStatus === "PROCESSING". Order matters. */
const PROCESSING_SUB_STEPS = [
  { key: "transcribing", label: "Transcribing meeting", description: "Converting speech to text" },
  { key: "diarizing", label: "Detecting speakers", description: "Identifying who said what" },
  { key: "understanding", label: "Understanding meeting", description: "Extracting topics and context" },
  { key: "summarizing", label: "Generating summary", description: "Writing the final summary" },
] as const;

/** Heuristic sub-step index from elapsed time — see file header. Each
 *  sub-step gets a fixed window; the last window holds indefinitely so we
 *  never claim "done" before the server says READY. */
const SUB_STEP_WINDOW_MS = 20_000;

function estimateActiveSubStep(sinceMs: number): number {
  const idx = Math.floor(sinceMs / SUB_STEP_WINDOW_MS);
  return Math.min(idx, PROCESSING_SUB_STEPS.length - 1);
}

export function buildProcessingSteps(status: string, updatedAt: string, now: number): ProcessingStep[] {
  const uploadState: StepState = status === "UPLOADING" ? "active" : "complete";

  const uploadStep: ProcessingStep = {
    key: "upload",
    label: "Upload complete",
    description: "Your recording has been uploaded",
    state: uploadState,
  };

  if (status === "READY") {
    return [
      uploadStep,
      ...PROCESSING_SUB_STEPS.map((s) => ({ ...s, state: "complete" as StepState })),
    ];
  }

  if (status === "UPLOADING") {
    return [
      uploadStep,
      ...PROCESSING_SUB_STEPS.map((s) => ({ ...s, state: "pending" as StepState })),
    ];
  }

  // PROCESSING (or FAILED — freeze the stepper at whatever sub-step it failed on)
  const sinceMs = Math.max(0, now - new Date(updatedAt).getTime());
  const activeIdx = estimateActiveSubStep(sinceMs);

  return [
    uploadStep,
    ...PROCESSING_SUB_STEPS.map((s, i) => ({
      ...s,
      state: (i < activeIdx ? "complete" : i === activeIdx ? "active" : "pending") as StepState,
    })),
  ];
}

/** "Step 2 of 5"-style caption above the stepper. The active sub-step
 *  (or the last one, once everything is complete) is what counts as the
 *  current step. */
export function currentStepLabel(steps: ProcessingStep[]): string {
  const total = steps.length;
  if (total === 0) return "";
  const activeIndex = steps.findIndex((s) => s.state === "active");
  if (activeIndex !== -1) return `Step ${activeIndex + 1} of ${total}`;
  const allComplete = steps.every((s) => s.state === "complete");
  return allComplete ? `Step ${total} of ${total}` : `Step 1 of ${total}`;
}

/** Overall 0-100 progress across every step — each complete step counts
 *  fully, the active one counts as half-done (no finer-grained real signal
 *  exists yet, see the module doc comment's known limitation). */
export function overallProgressPercent(steps: ProcessingStep[]): number {
  const total = steps.length;
  if (total === 0) return 0;
  const completeCount = steps.filter((s) => s.state === "complete").length;
  const hasActive = steps.some((s) => s.state === "active");
  const fraction = (completeCount + (hasActive ? 0.5 : 0)) / total;
  return Math.round(Math.min(100, fraction * 100));
}

export interface StepTimestamp {
  start: number;
  end: number | null;
}

/** Mutates `timestamps` in place: records when each non-pending step was
 *  first seen (its `start`) and when it first turned complete (its `end`).
 *  Called every render (see page.tsx) — safe to call repeatedly since both
 *  writes only ever happen once per key (a step's `start`/`end` never
 *  change after being set). */
export function recordStepTimestamps(
  steps: ProcessingStep[],
  timestamps: Record<string, StepTimestamp>,
  now: number,
): void {
  for (const step of steps) {
    if (step.state === "pending") continue;
    const existing = timestamps[step.key];
    if (!existing) {
      timestamps[step.key] = { start: now, end: step.state === "complete" ? now : null };
    } else if (step.state === "complete" && existing.end === null) {
      existing.end = now;
    }
  }
}

export function elapsedMsFor(step: ProcessingStep, timestamps: Record<string, StepTimestamp>, now: number): number | undefined {
  const rec = timestamps[step.key];
  if (!rec) return undefined;
  return (rec.end ?? now) - rec.start;
}

/** Rotating "what's happening right now" text per step — purely cosmetic
 *  (see the module header: there is no real per-step backend signal yet),
 *  so the user has something concrete-looking to read during a sub-step
 *  that can otherwise sit on one static label for up to SUB_STEP_WINDOW_MS. */
const STEP_ACTIVITY_MESSAGES: Record<string, string[]> = {
  upload: ["Uploading the recording…", "Verifying the upload…"],
  transcribing: [
    "Loading the speech-to-text model…",
    "Analyzing the audio waveform…",
    "Converting speech into text…",
    "Cleaning up recognized words…",
  ],
  diarizing: ["Detecting voice activity…", "Comparing voice embeddings…", "Grouping segments by speaker…"],
  understanding: ["Reading the full transcript…", "Finding topics and decisions…", "Spotting action items…"],
  summarizing: ["Drafting the overview…", "Polishing the summary…"],
};
const ACTIVITY_CYCLE_MS = 2500;

export function activityTextFor(stepKey: string, elapsedMs: number): string | undefined {
  const messages = STEP_ACTIVITY_MESSAGES[stepKey];
  if (!messages || messages.length === 0) return undefined;
  return messages[Math.floor(elapsedMs / ACTIVITY_CYCLE_MS) % messages.length];
}

export function formatDurationSec(durationSec: number | null): string {
  if (durationSec == null) return "--:--";
  // Round the whole duration first, THEN split into minutes/seconds —
  // rounding `mins` and `secs` independently let a fractional remainder
  // that rounds up to 60 (e.g. 59.6s) produce "0:60" instead of "1:00".
  const totalSecs = Math.round(durationSec);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "--";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
