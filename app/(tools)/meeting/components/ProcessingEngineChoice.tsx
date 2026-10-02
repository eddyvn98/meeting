"use client";

import { Cpu, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProcessingEngine } from "@/lib/meeting/processing/processingEngine";

/** Shown on phones after a recording ends: live transcription was paid-only,
 *  the final pass is the user's choice (free on our server, or paid API). */
export function ProcessingEngineChoice({ onChoose }: { onChoose: (engine: ProcessingEngine) => void }) {
  return (
    <div className="w-full rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-sm font-medium text-card-foreground">How should we process this recording?</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Your recording is saved. Pick how to create the final transcript and speaker labels.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Button variant="outline" className="h-auto justify-start gap-2 py-2 text-left" onClick={() => onChoose("server")}>
          <Cpu className="h-4 w-4 shrink-0 text-emerald-500" />
          <span className="flex flex-col">
            <span className="text-sm font-medium">Low (free)</span>
            <span className="text-xs font-normal text-muted-foreground">Processed on our server, slower</span>
          </span>
        </Button>
        <Button variant="outline" className="h-auto justify-start gap-2 py-2 text-left" onClick={() => onChoose("api")}>
          <Zap className="h-4 w-4 shrink-0 fill-amber-500 text-amber-500" />
          <span className="flex flex-col">
            <span className="text-sm font-medium">Paid (fast)</span>
            <span className="text-xs font-normal text-muted-foreground">Processed by the paid API</span>
          </span>
        </Button>
      </div>
    </div>
  );
}
