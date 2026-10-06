import type { MeetingBotStatus } from "./types";

const ALLOWED_TRANSITIONS: Record<MeetingBotStatus, readonly MeetingBotStatus[]> = {
  REQUESTED: ["REQUESTED"],
  CLAIMED: ["CLAIMED", "JOINING", "STOP_REQUESTED", "ENDED", "FAILED"],
  JOINING: ["JOINING", "LOBBY", "JOINED", "STOP_REQUESTED", "ENDED", "FAILED"],
  LOBBY: ["LOBBY", "JOINED", "STOP_REQUESTED", "ENDED", "FAILED"],
  JOINED: ["JOINED", "CAPTURING", "STOP_REQUESTED", "ENDED", "FAILED"],
  CAPTURING: ["CAPTURING", "STOP_REQUESTED", "ENDED", "FAILED"],
  STOP_REQUESTED: ["STOP_REQUESTED", "ENDED", "FAILED"],
  ENDED: ["ENDED"],
  FAILED: ["FAILED"],
};

export function canTransitionMeetingBotStatus(
  current: MeetingBotStatus,
  next: MeetingBotStatus,
): boolean {
  return ALLOWED_TRANSITIONS[current].includes(next);
}

export function allowedMeetingBotTransitions(
  current: MeetingBotStatus,
): readonly MeetingBotStatus[] {
  return ALLOWED_TRANSITIONS[current];
}
