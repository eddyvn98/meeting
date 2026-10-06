export const ACTIVE_RECORDER_SESSION_STATUSES = [
  "CLAIMED",
  "JOINING",
  "LOBBY",
  "JOINED",
  "CAPTURING",
  "STOP_REQUESTED",
] as const;

const RESERVED_MEETING_ROOTS = new Set([
  "bot-schedules",
  "bot-sessions",
  "glossary",
  "groups",
  "notifications",
  "public",
  "storage-info",
  "usage",
  "voice-profiles",
  "whisper-cpp-main",
]);

export interface RecorderScopeSession {
  id: string;
  ownerEmail: string;
  status: string;
  meetingId: string | null;
}

export function isRecorderSessionActive(status: string): boolean {
  return (ACTIVE_RECORDER_SESSION_STATUSES as readonly string[]).includes(status);
}

/**
 * Recorder JWTs deliberately reuse the owner's email because the existing
 * recording/processing APIs store Meeting.ownerEmail as the identity. This
 * helper is the security boundary that prevents such a JWT from becoming an
 * owner-wide browser session.
 *
 * A recorder may:
 * - POST /api/meeting once to create its own Meeting row;
 * - operate only underneath /api/meeting/{itsMeetingId}[/*];
 * - call the stateless live-translation endpoint used by the recording UI.
 *
 * It may never access bot administration, groups, notifications, other
 * meetings, or owner-wide collection APIs.
 */
export function isBotRecorderRequestAllowed(
  pathname: string,
  method: string,
  session: RecorderScopeSession,
): boolean {
  if (!isRecorderSessionActive(session.status)) return false;

  const normalizedMethod = method.toUpperCase();
  if (pathname === "/api/meeting") {
    return normalizedMethod === "POST" && !session.meetingId;
  }

  if (pathname === "/api/meeting/translate-live") {
    return normalizedMethod === "POST";
  }

  const match = pathname.match(/^\/api\/meeting\/([^/]+)(?:\/|$)/);
  if (!match) return false;

  const firstSegment = decodeURIComponent(match[1]);
  if (RESERVED_MEETING_ROOTS.has(firstSegment)) return false;
  if (!session.meetingId || firstSegment !== session.meetingId) return false;

  // The bot-created meeting is disposable capture state, but deleting or
  // renaming it is never part of the recorder pipeline. Keep root mutations
  // human-only even though reads are needed for processing-status polling.
  if (pathname === `/api/meeting/${encodeURIComponent(session.meetingId)}`) {
    return normalizedMethod === "GET";
  }

  return true;
}
