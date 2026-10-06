"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { isRetryableFinalizeFailure } from "@/lib/meeting/audio/finalizeRetry";
import type { Meeting } from "@/lib/meeting/types";

/** Shown when the server could not finalize a finished recording. The audio is
 *  safe on the server, so finalizing again is enough; no re-recording needed. */
export function FinalizeRetryButton({ meeting, onDone }: { meeting: Meeting; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isRetryableFinalizeFailure(meeting)) return null;

  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meeting/${meeting.id}/finalize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error("It still could not be finalized. Your audio is saved; try again in a moment.");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Finalize failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={retry}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        Finalize again
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
