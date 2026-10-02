"use client";

import { useEffect } from "react";
import type { TranscriptSegment } from "@/lib/meeting/types";

export function useLiveMeetingTranscript(
  meetingId: string,
  status: string | undefined,
  onSegment: (segment: TranscriptSegment) => void,
  onStatus?: (status: string) => void,
) {
  useEffect(() => {
    if (!meetingId || status === "READY" || status === "FAILED") return;
    const source = new EventSource(`/api/meeting/${encodeURIComponent(meetingId)}/live-transcript`);
    const handleSegment = (event: MessageEvent<string>) => {
      try { onSegment(JSON.parse(event.data) as TranscriptSegment); } catch { /* ignore malformed event */ }
    };
    const handleStatus = (event: MessageEvent<string>) => {
      try { onStatus?.((JSON.parse(event.data) as { status?: string }).status ?? ""); } catch { /* ignore malformed event */ }
    };
    source.addEventListener("segment", handleSegment as EventListener);
    source.addEventListener("status", handleStatus as EventListener);
    return () => {
      source.removeEventListener("segment", handleSegment as EventListener);
      source.removeEventListener("status", handleStatus as EventListener);
      source.close();
    };
  }, [meetingId, onSegment, onStatus, status]);
}
