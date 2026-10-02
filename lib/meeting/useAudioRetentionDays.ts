"use client";

import { useEffect, useState } from "react";

/**
 * lib/meeting/useAudioRetentionDays.ts
 *
 * Fetches GET /api/meeting/storage-info once per page load (module-level
 * cache, same pattern as the other meeting caches in this module — see
 * detailCache in [meetingId]/page.tsx) and shares the retention-days number
 * across every consumer: the sidebar's per-row expiry warning
 * (MeetingAsideRecentItem.tsx) and the result page's expiry banner both need
 * it, and it changes only via server env config, never per-session.
 */

let cachedRetentionDays: number | null = null;
let inFlight: Promise<number | null> | null = null;

function fetchRetentionDays(): Promise<number | null> {
  if (cachedRetentionDays !== null) return Promise.resolve(cachedRetentionDays);
  if (!inFlight) {
    inFlight = fetch("/api/meeting/storage-info")
      .then((res) => (res.ok ? (res.json() as Promise<{ retentionDays: number }>) : null))
      .then((info) => {
        if (info) cachedRetentionDays = info.retentionDays;
        return cachedRetentionDays;
      })
      .catch(() => null)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function useAudioRetentionDays(): number | null {
  const [retentionDays, setRetentionDays] = useState(cachedRetentionDays);

  useEffect(() => {
    if (retentionDays !== null) return;
    let cancelled = false;
    fetchRetentionDays().then((days) => {
      if (!cancelled) setRetentionDays(days);
    });
    return () => {
      cancelled = true;
    };
  }, [retentionDays]);

  return retentionDays;
}
