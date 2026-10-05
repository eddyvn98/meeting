export const DIFY_BLOCKING_MAX_ATTEMPTS = 2;
export const DIFY_RETRY_BACKOFF_MS = 350;

export function isRetriableDifyStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function shouldRetryDifyAttempt(attempt: number, status?: number): boolean {
  if (attempt >= DIFY_BLOCKING_MAX_ATTEMPTS) return false;
  return status === undefined || isRetriableDifyStatus(status);
}

export function waitForDifyRetry(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, DIFY_RETRY_BACKOFF_MS));
}
