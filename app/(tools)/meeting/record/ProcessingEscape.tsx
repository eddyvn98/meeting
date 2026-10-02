"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const SHOW_AFTER_MS = 3 * 60_000;

/** A way out of a processing run that is taking too long. Appears after a few
 *  minutes (so it is not clicked by accident) and hands over to the same
 *  retry / other-engine choices that a failure shows. */
export function ProcessingEscape({ onAbort }: { onAbort: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">Taking longer than expected? You can stop this and choose another way to process the recording.</p>
      <Button size="sm" variant="outline" onClick={onAbort}>
        Stop and choose another way
      </Button>
    </div>
  );
}
