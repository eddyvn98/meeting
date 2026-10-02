/**
 * lib/meeting/recorder/liveTranscriptOption.ts
 *
 * Persists and retrieves user preference for enabling real-time
 * live transcription during meeting recording.
 */

import { isMobileDevice } from "../stt/mobileDevice";

export const LIVE_TRANSCRIPT_STORAGE_KEY = "meeting-live-transcript-enabled";

export function getStoredLiveTranscriptEnabled(): boolean {
  if (typeof window === "undefined") return true;
  // Live transcription is off by default on phones (it costs API calls and
  // battery); a stored choice always wins.
  try {
    const stored = localStorage.getItem(LIVE_TRANSCRIPT_STORAGE_KEY);
    if (stored !== null) return stored !== "false";
  } catch {
    // Fall through to the default.
  }
  return !isMobileDevice();
}

export function setStoredLiveTranscriptEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LIVE_TRANSCRIPT_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore localStorage access errors
  }
}

export const LIVE_TRANSLATION_STORAGE_KEY = "meeting-live-translation-enabled";

export function getStoredLiveTranslationEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(LIVE_TRANSLATION_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setStoredLiveTranslationEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LIVE_TRANSLATION_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore localStorage access errors
  }
}
