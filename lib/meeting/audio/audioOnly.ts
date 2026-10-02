/**
 * lib/meeting/audio/audioOnly.ts
 *
 * An "audio-only" meeting is one whose transcription did not (or could not)
 * complete, but whose recording is safe: it is opened as an empty Overview
 * where the audio can be played and downloaded, and transcription can be
 * retried later. It is stored as a READY meeting whose failureReason starts
 * with AUDIO_ONLY_PREFIX; a successful transcript save clears the reason, so
 * the marker disappears by itself. Pure, shared by routes and the UI.
 */

export const AUDIO_ONLY_PREFIX = "Transcription was not completed: ";

export function isAudioOnlyResult(meeting: { status: string; failureReason: string | null }): boolean {
  return meeting.status === "READY" && Boolean(meeting.failureReason?.startsWith(AUDIO_ONLY_PREFIX));
}

/** The reason shown to the user, without the marker prefix. */
export function audioOnlyReason(failureReason: string | null): string {
  return failureReason?.startsWith(AUDIO_ONLY_PREFIX) ? failureReason.slice(AUDIO_ONLY_PREFIX.length) : "";
}
