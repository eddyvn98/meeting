type ReleaseSlot = () => void;

interface WaitingRequest {
  resolve: (release: ReleaseSlot | null) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}
const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_MAX_QUEUE = 8;

function readPositiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const maxConcurrent = readPositiveInt(
  "MEETING_LIVE_TRANSLATION_MAX_CONCURRENT",
  DEFAULT_MAX_CONCURRENT,
);
const maxQueue = readPositiveInt("MEETING_LIVE_TRANSLATION_MAX_QUEUE", DEFAULT_MAX_QUEUE);

let active = 0;
const waiting: WaitingRequest[] = [];

function releaseSlot(): void {
  active = Math.max(0, active - 1);
  drain();
}

function grant(request: WaitingRequest): void {
  active += 1;
  if (request.signal && request.onAbort) request.signal.removeEventListener("abort", request.onAbort);
  request.resolve(releaseSlot);
}

function drain(): void {
  while (active < maxConcurrent && waiting.length > 0) {
    const request = waiting.shift();
    if (!request) return;
    if (request.signal?.aborted) {
      request.resolve(null);
      continue;
    }
    grant(request);
  }
}

/**
 * Bounds live translation work per Next.js process so multiple meetings cannot
 * overload the Dify worker pool at the same time.
 */
export function acquireLiveTranslationSlot(signal?: AbortSignal): Promise<ReleaseSlot | null> {
  if (signal?.aborted) return Promise.resolve(null);
  if (active < maxConcurrent) {
    active += 1;
    return Promise.resolve(releaseSlot);
  }
  if (waiting.length >= maxQueue) return Promise.resolve(null);

  return new Promise((resolve) => {
    const request: WaitingRequest = { resolve, signal };
    if (signal) {
      request.onAbort = () => {
        const index = waiting.indexOf(request);
        if (index >= 0) waiting.splice(index, 1);
        resolve(null);
      };
      signal.addEventListener("abort", request.onAbort, { once: true });
    }
    waiting.push(request);
  });
}
