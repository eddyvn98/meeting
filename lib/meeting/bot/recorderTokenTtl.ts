const DEFAULT_TOKEN_TTL_SEC = 6 * 60 * 60;
const TOKEN_FINALIZE_GRACE_SEC = 30 * 60;
const DEFAULT_PROCESSING_MAX_SEC = 90 * 60;
const MAX_TOKEN_TTL_SEC = 24 * 60 * 60;

export function recorderTokenTtlSec(env: NodeJS.ProcessEnv = process.env): number {
  const configuredTtl = Number(env.MEETING_BOT_RECORDER_TOKEN_TTL_SEC);
  const configuredMaxDurationMs = Number(env.MEETING_BOT_MAX_DURATION_MS);
  const configuredProcessingMaxMs = Number(env.MEETING_BOT_PROCESSING_TIMEOUT_MAX_MS);
  const meetingDurationSec =
    Number.isFinite(configuredMaxDurationMs) && configuredMaxDurationMs > 0
      ? Math.ceil(configuredMaxDurationMs / 1000)
      : 4 * 60 * 60;
  const processingMaxSec =
    Number.isFinite(configuredProcessingMaxMs) && configuredProcessingMaxMs > 0
      ? Math.ceil(configuredProcessingMaxMs / 1000)
      : DEFAULT_PROCESSING_MAX_SEC;
  const safeMinimum = Math.max(
    DEFAULT_TOKEN_TTL_SEC,
    meetingDurationSec + TOKEN_FINALIZE_GRACE_SEC + processingMaxSec,
  );
  const requested =
    Number.isFinite(configuredTtl) && configuredTtl > 0
      ? Math.max(Math.ceil(configuredTtl), safeMinimum)
      : safeMinimum;
  return Math.min(MAX_TOKEN_TTL_SEC, requested);
}
