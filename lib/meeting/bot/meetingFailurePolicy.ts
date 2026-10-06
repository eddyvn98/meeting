import { isFinalizeInProgress } from "@/lib/meeting/audio/finalizeRetry";

export type MeetingBotFailureScope = "CAPTURE" | "PROCESSING";

export function shouldFailMeetingForBotFailure(
  meeting: { status: string; failureReason: string | null },
  scope: MeetingBotFailureScope,
): boolean {
  if (scope === "PROCESSING") return meeting.status === "PROCESSING";
  return meeting.status === "UPLOADING" && !isFinalizeInProgress(meeting);
}
