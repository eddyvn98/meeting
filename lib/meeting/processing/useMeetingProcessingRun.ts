"use client";

/**
 * lib/meeting/processing/useMeetingProcessingRun.ts
 *
 * Runs the final transcription pass once for a finalized meeting and exposes
 * a failure the user must decide on. Shared by the Processing screen and the
 * recording screen, which both start processing right after "End meeting".
 *
 * A failure is NOT hidden behind another engine or a placeholder result:
 * `failure` is set and the UI asks whether to retry or switch engine (the
 * paid API costs money, so that is the user's call). The meeting stays in
 * PROCESSING until a run succeeds; re-opening it starts a fresh attempt.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CHUNK_DURATION_SEC, LOCAL_STT_WINDOW_SEC } from "@/lib/meeting/stt/chunkConstants";
import { resetSttWorker } from "@/lib/meeting/stt/sttWorkerClient";
import { runLocalMeetingProcessing } from "./runLocalMeetingProcessing";
import type { ProcessingEngine } from "./processingEngine";

/** Time allowed before the audio duration is known (download + decode, and a
 *  model download on first use). */
const START_TIMEOUT_MS = 120_000;
/** Stall detection: re-armed after every finished chunk, so a long meeting
 *  keeps going as long as it makes steady progress. The API answers each
 *  window in seconds; Whisper on CPU can take several times real-time. */
const STALL_TIMEOUT_MS: Record<ProcessingEngine, number> = {
  api: 5 * 60_000,
  server: Math.max(START_TIMEOUT_MS, CHUNK_DURATION_SEC * 1000 * 6),
  // The in-browser model works in LOCAL_STT_WINDOW_SEC windows (see
  // chunkConstants.ts): allow each one up to 6x real time before declaring it stuck.
  auto: Math.max(START_TIMEOUT_MS, LOCAL_STT_WINDOW_SEC * 1000 * 6),
};

/** Name of the cross-tab lock: only one tab may transcribe a given meeting. */
const processingLockName = (meetingId: string) => `meeting-processing:${meetingId}`;

async function touchProcessingHeartbeat(meetingId: string): Promise<void> {
  try {
    await fetch(`/api/meeting/${encodeURIComponent(meetingId)}/processing-heartbeat`, {
      method: "POST",
      cache: "no-store",
    });
  } catch {
    // Best effort only. The processing run itself remains authoritative; the
    // next completed chunk gets another chance to refresh the stale deadline.
  }
}

async function stillNeedsProcessing(meetingId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/meeting/${encodeURIComponent(meetingId)}`, { cache: "no-store" });
    if (!res.ok) return false;
    return ((await res.json()) as { status?: string }).status === "PROCESSING";
  } catch {
    return false;
  }
}

export interface ProcessingFailure {
  engine: ProcessingEngine;
  reason: string;
}

interface Options {
  meetingId: string | null;
  /** True once the meeting is finalized (status PROCESSING). */
  enabled: boolean;
  /** Engine for the first attempt; null while it is still being determined. */
  engine: ProcessingEngine | null;
  sttLanguage?: string;
}

export function useMeetingProcessingRun({ meetingId, enabled, engine, sttLanguage }: Options) {
  const [failure, setFailure] = useState<ProcessingFailure | null>(null);
  // True while another tab of this browser is already processing this meeting.
  const [inOtherTab, setInOtherTab] = useState(false);
  const startedRef = useRef(false);
  const releaseLockRef = useRef<(() => void) | null>(null);
  const engineRef = useRef<ProcessingEngine | null>(null);
  const runIdRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  /** Releases the cross-tab lock taken for the current run, if any. */
  const releaseLock = () => {
    releaseLockRef.current?.();
    releaseLockRef.current = null;
  };

  const run = useCallback(
    (next: ProcessingEngine) => {
      if (!meetingId) return;
      engineRef.current = next;
      const runId = ++runIdRef.current;
      const isCurrent = () => runIdRef.current === runId;
      let settled = false;
      setFailure(null);

      const fail = (reason: string) => {
        if (settled || !isCurrent()) return;
        settled = true;
        clearTimer();
        // A run that stalled may be stuck inside the speech worker, which cannot
        // be interrupted: kill it so a retry (or another engine) starts clean
        // instead of queueing behind the stuck call forever.
        resetSttWorker(reason);
        releaseLock();
        setFailure({ engine: next, reason });
      };
      const arm = (ms: number) => {
        clearTimer();
        timerRef.current = window.setTimeout(() => fail("Processing stopped making progress."), ms);
      };
      const onProgress = () => {
        if (isCurrent() && !settled) {
          void touchProcessingHeartbeat(meetingId);
          arm(STALL_TIMEOUT_MS[next]);
        }
      };

      const start = () => {
        setInOtherTab(false);
        void touchProcessingHeartbeat(meetingId);
        arm(START_TIMEOUT_MS);
        void runLocalMeetingProcessing(meetingId, onProgress, onProgress, next, sttLanguage).then((outcome) => {
          if (!isCurrent()) return;
          if (outcome.ok) {
            settled = true;
            clearTimer();
            releaseLock();
          } else {
            fail(outcome.reason);
          }
        });
      };

      // Two tabs transcribing the same meeting would fight over the CPU and
      // both stall. The lock is held until this run ends; a second tab waits
      // and takes over if the first one closes before finishing.
      releaseLock();
      const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
      if (!locks) {
        start();
        return;
      }
      void locks.request(processingLockName(meetingId), { ifAvailable: true }, (lock) => {
        if (lock) {
          if (!isCurrent()) return;
          start();
          return new Promise<void>((release) => {
            releaseLockRef.current = () => release();
          });
        }
        if (!isCurrent()) return;
        setInOtherTab(true);
        // Wait for the other run; when it finishes or its tab closes, take over
        // only if the meeting is still waiting for a transcript.
        return locks.request(processingLockName(meetingId), async () => {
          if (!isCurrent() || !(await stillNeedsProcessing(meetingId))) {
            setInOtherTab(false);
            return;
          }
          start();
          return new Promise<void>((release) => {
            releaseLockRef.current = () => release();
          });
        });
      });
    },
    [meetingId, sttLanguage],
  );

  /** Gives the user a way out of a run that is taking too long: stops it and
   *  shows the same choices as a failure (retry, other engine). */
  const abort = useCallback(() => {
    if (!meetingId) return;
    runIdRef.current++;
    clearTimer();
    resetSttWorker("Stopped by you.");
    releaseLock();
    setInOtherTab(false);
    setFailure({ engine: engineRef.current ?? "auto", reason: "You stopped processing." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  useEffect(() => {
    if (!enabled || !engine || startedRef.current) return;
    startedRef.current = true;
    run(engine);
  }, [enabled, engine, run]);

  return { failure, retry: run, abort, inOtherTab };
}
