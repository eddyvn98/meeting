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
const RECORDER_MEETING_ROUTES = new Map<string, ReadonlySet<string>>([
  ["audio", new Set(["GET"])],
  ["chunks", new Set(["POST"])],
  ["full-audio", new Set(["POST"])],
  ["finalize", new Set(["POST"])],
  ["live-transcript", new Set(["POST"])],
  ["transcribe", new Set(["POST"])],
  ["transcribe-fast", new Set(["POST"])],
  ["transcribe-chunk", new Set(["POST"])],
  ["diarize-chunk", new Set(["POST"])],
  ["transcript", new Set(["POST"])],
]);

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

  // Read-only access to the shared voice library is required by local
  // diarization to label known speakers. Recorder tokens can never mutate it.
  if (pathname === "/api/meeting/voice-profiles") {
    return normalizedMethod === "GET";
  }

  const match = pathname.match(/^\/api\/meeting\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!match) return false;

  const meetingId = decodeURIComponent(match[1]);
  if (RESERVED_MEETING_ROOTS.has(meetingId)) return false;
  if (!session.meetingId || meetingId !== session.meetingId) return false;

  const action = match[2];
  if (!action) return normalizedMethod === "GET";

  return RECORDER_MEETING_ROUTES.get(action)?.has(normalizedMethod) ?? false;
}
