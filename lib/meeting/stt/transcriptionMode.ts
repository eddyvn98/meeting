"use client";

/**
 * lib/meeting/stt/transcriptionMode.ts
 *
 * Manages the transcription mode selection for Meeting:
 * - "low": Local model (Whisper WASM on CPU/WebGPU) — 100% free, private in browser.
 * - "fast": OpenRouter MAI-Transcribe 2 cloud transcription — low latency, high accuracy.
 */

export type MeetingTranscriptionMode = "low" | "fast";

export interface TranscriptionModeOption {
  mode: MeetingTranscriptionMode;
  label: string;
  badge: string;
  description: string;
}

export const TRANSCRIPTION_MODES: readonly TranscriptionModeOption[] = [
  {
    mode: "low",
    label: "low (free)",
    badge: "Free",
    description: "Run local Whisper model in browser — free, private, offline-capable",
  },
  {
    mode: "fast",
    label: "fast (paid)",
    badge: "Paid",
    description: "Use paid OpenRouter MAI-Transcribe 2 for the transcript — low latency, high accuracy",
  },
] as const;

export const DEFAULT_TRANSCRIPTION_MODE: MeetingTranscriptionMode = "low";
const STORAGE_KEY = "meeting_stt_mode_v1";

import { isMobileDevice } from "./mobileDevice";

export { isMobileDevice };

/** The mode used for LIVE transcription: phones never run the local model
 *  in the tab, so live "low" is served by the transcription API there. The
 *  final (post-meeting / upload) transcription is different: on a phone "low"
 *  runs the free Whisper model on our server, "fast" uses the paid API. */
export function effectiveTranscriptionMode(mode: MeetingTranscriptionMode): MeetingTranscriptionMode {
  return isMobileDevice() ? "fast" : mode;
}

/** The user's stored choice. With nothing stored, phones start on "fast" and
 *  desktops on the default. */
export function getStoredTranscriptionMode(): MeetingTranscriptionMode {
  const fallback: MeetingTranscriptionMode = isMobileDevice() ? "fast" : DEFAULT_TRANSCRIPTION_MODE;
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "low" || raw === "fast") return raw;
  } catch {
    // Ignore localStorage access errors (e.g. incognito restrictions)
  }
  return fallback;
}

/** Mode for a meeting recorded in the app. Phones only offer "fast" when
 *  recording, so a "low" picked for an upload never leaks into a recording. */
export function getRecordingTranscriptionMode(): MeetingTranscriptionMode {
  return isMobileDevice() ? "fast" : getStoredTranscriptionMode();
}

export function setStoredTranscriptionMode(mode: MeetingTranscriptionMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Ignore localStorage access errors
  }
}

const UPLOAD_STORAGE_KEY = "meeting_upload_stt_mode_v1";

/** Upload flow keeps its own mode so it never mirrors the record flow. */
export function getStoredUploadTranscriptionMode(): MeetingTranscriptionMode {
  if (typeof window === "undefined") return DEFAULT_TRANSCRIPTION_MODE;
  try {
    const raw = window.localStorage.getItem(UPLOAD_STORAGE_KEY);
    if (raw === "low" || raw === "fast") return raw;
  } catch {
    // Ignore localStorage access errors
  }
  return DEFAULT_TRANSCRIPTION_MODE;
}

export function setStoredUploadTranscriptionMode(mode: MeetingTranscriptionMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(UPLOAD_STORAGE_KEY, mode);
  } catch {
    // Ignore localStorage access errors
  }
}
