import type { MeetingBotStatus } from "./types";

/** User-facing status wording. Internal runner states are collapsed so the UI never exposes them. */
const STATUS_LABELS: Record<MeetingBotStatus, string> = {
  REQUESTED: "Starting",
  CLAIMED: "Starting",
  JOINING: "Joining the meeting",
  LOBBY: "Waiting to be admitted",
  JOINED: "In the meeting",
  CAPTURING: "Recording",
  STOP_REQUESTED: "Stopping",
  ENDED: "Finished",
  FAILED: "Couldn't join",
};

export function friendlyStatusLabel(status: MeetingBotStatus): string {
  return STATUS_LABELS[status] ?? "Finished";
}

/**
 * Maps a raw runner error (Playwright messages, env var names, timeouts) to a
 * short sentence a meeting attendee can act on. The raw text is never shown.
 */
export function friendlyBotError(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw.toLowerCase();
  if (text.includes("lobby")) return "The bot was not admitted to the meeting.";
  if (text.includes("join timed out") || text.includes("timeout")) return "The bot could not join in time.";
  if (text.includes("heartbeat")) return "The bot lost connection during the meeting.";
  return "Something went wrong while the bot was in the meeting.";
}
