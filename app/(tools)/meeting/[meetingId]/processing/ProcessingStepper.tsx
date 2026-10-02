"use client";

import { Check } from "lucide-react";
import { formatClock } from "@/lib/meeting/format";
import type { ProcessingStep } from "./processingSteps";

/**
 * Vertical stepper for the "Uploading & Processing" screen. State colors
 * (per Meeting design tokens, "Design tokens"): complete =
 * green (chosen once here: `text-green-600 dark:text-green-400`, reused by
 * every icon/line/label in this component), active = brand orange filled
 * dot + bold label, pending = muted-foreground empty circle. A completed
 * step shows how long it took (`elapsedMs`, frozen — see
 * processingSteps.ts's recordStepTimestamps); the active step instead shows
 * a live running counter plus a rotating "what's happening" line
 * (`activityText`) so it doesn't just sit on one static label.
 */
export function ProcessingStepper({ steps }: { steps: ProcessingStep[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((step, i) => (
        <li key={step.key} className="flex gap-3">
          <div className="flex flex-col items-center">
            <StepIcon state={step.state} />
            {i < steps.length - 1 && (
              <span
                className={`w-px flex-1 ${
                  step.state === "complete" ? "bg-green-600 dark:bg-green-400" : "bg-border"
                }`}
                style={{ minHeight: "1.75rem" }}
              />
            )}
          </div>
          <div className="pb-7">
            <div className="flex items-baseline gap-2">
              <p
                className={
                  step.state === "active"
                    ? "text-sm font-semibold text-primary"
                    : step.state === "complete"
                      ? "text-sm font-medium text-foreground"
                      : "text-sm font-medium text-muted-foreground"
                }
              >
                {step.label}
              </p>
              {step.elapsedMs !== undefined && (
                <span className="text-xs tabular-nums text-muted-foreground">{formatClock(step.elapsedMs)}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {step.state === "active" && step.activityText ? step.activityText : step.description}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function StepIcon({ state }: { state: ProcessingStep["state"] }) {
  if (state === "complete") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-600 dark:bg-green-400">
        <Check className="h-3.5 w-3.5 text-white dark:text-background" strokeWidth={3} />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        <span className="h-3 w-3 animate-pulse rounded-full bg-primary" />
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center">
      <span className="h-3 w-3 rounded-full border-2 border-border" />
    </span>
  );
}
