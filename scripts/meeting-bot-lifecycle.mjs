/**
 * scripts/meeting-bot-lifecycle.mjs
 *
 * Pure, dependency-free lifecycle logic for meeting-bot-runner.mjs: the
 * post-recording processing-wait timeout, the alone-in-call timer state
 * machine, max-duration detection, and the stale-PROCESSING check reused
 * by the claim route's recovery sweep. Kept side-effect-free (no fetch, no
 * timers, no DOM) so it can be unit tested without Playwright or a DB —
 * see __tests__/meeting/meetingBotLifecycle.test.ts.
 */

const MINUTE_MS = 60_000;

/**
 * How long the runner should keep the STT/recorder browser open, polling
 * for the meeting to reach READY/FAILED, before giving up and forcing a
 * mock-complete. Derived from the recorded meeting duration when known
 * (`recordedMs`): max(10min, 1.5x the recording), capped at 90min.
 * Falls back to the flat default when the duration isn't known yet.
 */
export function computeProcessingTimeoutMs({
  recordedMs,
  minMs = 10 * MINUTE_MS,
  maxMs = 90 * MINUTE_MS,
  multiplier = 1.5,
  defaultMs = 45 * MINUTE_MS,
} = {}) {
  if (!Number.isFinite(recordedMs) || recordedMs === undefined || recordedMs === null || recordedMs <= 0) {
    return clamp(defaultMs, minMs, maxMs);
  }
  return clamp(recordedMs * multiplier, minMs, maxMs);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** True once `nowMs - startedAtMs` reaches `maxDurationMs`. */
export function isMaxDurationExceeded(startedAtMs, nowMs, maxDurationMs) {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(maxDurationMs)) return false;
  return nowMs - startedAtMs >= maxDurationMs;
}

/**
 * Alone-in-call timer state machine. Call `nextAloneState(state, isAlone,
 * nowMs)` on every poll tick; it returns the next state plus whether the
 * bot has now been continuously alone for >= `aloneTimeoutMs`. Any tick
 * that observes someone else present resets the timer (the timeout only
 * fires on a CONTINUOUS alone streak, never a cumulative one).
 */
export function initialAloneState() {
  return { aloneSinceMs: null };
}

export function nextAloneState(state, isAlone, nowMs, aloneTimeoutMs) {
  if (!isAlone) return { aloneSinceMs: null, shouldEnd: false, aloneForMs: 0 };
  const aloneSinceMs = state?.aloneSinceMs ?? nowMs;
  const aloneForMs = nowMs - aloneSinceMs;
  return { aloneSinceMs, shouldEnd: aloneForMs >= aloneTimeoutMs, aloneForMs };
}

/**
 * Best-effort participant count from Teams roster/UI text. Looks for
 * patterns like "5 people", "People (5)", "3 participants" — the first
 * plausible match wins. Returns null when nothing recognizable is found
 * (callers must treat null as "unknown", never as "alone").
 */
export function parseParticipantCount(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const patterns = [
    /people\s*\((\d+)\)/i,
    /participants\s*\((\d+)\)/i,
    /(\d+)\s+people\b/i,
    /(\d+)\s+participants\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const count = Number(match[1]);
      if (Number.isFinite(count) && count >= 0) return count;
    }
  }
  return null;
}

/** True when a participant count is known and the bot is the only one in
 *  the call (count <= 1, since the bot itself counts as one participant). */
export function isAloneFromCount(count) {
  return typeof count === "number" && Number.isFinite(count) && count <= 1;
}

/**
 * True when a Meeting has been sitting in PROCESSING since before the
 * stale deadline (`nowMs - updatedAtMs >= staleMs`). Shared by the claim
 * route's recovery sweep and the reprocess route's "stuck, not just
 * mock" allowance.
 */
export function isStaleProcessing(status, updatedAtMs, nowMs, staleMs) {
  if (status !== "PROCESSING") return false;
  if (!Number.isFinite(updatedAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(staleMs)) return false;
  return nowMs - updatedAtMs >= staleMs;
}
