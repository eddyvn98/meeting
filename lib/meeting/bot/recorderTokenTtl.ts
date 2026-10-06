const DEFAULT_TOKEN_TTL_SEC = 6 * 60 * 60;
const TOKEN_FINALIZE_GRACE_SEC = 30 * 60;
const MAX_TOKEN_TTL_SEC = 24 * 60 * 60;

export function recorderTokenTtlSec(env: NodeJS.ProcessEnv = process.env): number {
  const configuredTtl = Number(env.MEETING_BOT_RECORDER_TOKEN_TTL_SEC);
  const configuredMaxDurationMs = Number(env.MEETING_BOT_MAX_DURATION_MS);
  const durationBased =
    Number.isFinite(configuredMaxDurationMs) && configuredMaxDurationMs > 0
      ? Math.ceil(configuredMaxDurationMs / 1000) + TOKEN_FINALIZE_GRACE_SEC
      : DEFAULT_TOKEN_TTL_SEC;
  const requested =
    Number.isFinite(configuredTtl) && configuredTtl > 0
      ? Math.ceil(configuredTtl)
      : Math.max(DEFAULT_TOKEN_TTL_SEC, durationBased);
  return Math.min(MAX_TOKEN_TTL_SEC, Math.max(DEFAULT_TOKEN_TTL_SEC, requested));
}
