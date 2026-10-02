/** Bounded backpressure for CPU-heavy server-side STT fallback inference. */

const DEFAULT_CONCURRENCY = 1;
const DEFAULT_MAX_QUEUE = 8;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

const maxConcurrent = envInt("MEETING_SERVER_STT_CONCURRENCY", DEFAULT_CONCURRENCY, 1, 8);
const maxQueued = envInt("MEETING_SERVER_STT_MAX_QUEUE", DEFAULT_MAX_QUEUE, 0, 100);

let active = 0;
const waiters: (() => void)[] = [];

export class MeetingSttBusyError extends Error {
  constructor() {
    super("Server STT queue is full");
    this.name = "MeetingSttBusyError";
  }
}

export async function acquireMeetingSttSlot(): Promise<() => void> {
  if (active < maxConcurrent) {
    active++;
    return releaseSlot;
  }
  if (waiters.length >= maxQueued) throw new MeetingSttBusyError();
  await new Promise<void>((resolve) => waiters.push(resolve));
  // releaseSlot() below hands its slot directly to us (via the resolved
  // promise) without ever decrementing `active` for it — so we must NOT
  // increment here. Doing so previously left a window where `active` was
  // decremented and a brand-new, unrelated acquire() could grab the
  // "freed" slot before this waiter resumed, letting more than
  // maxConcurrent jobs run at once and queue-jumping the longest waiter.
  return releaseSlot;
}

function releaseSlot(): void {
  const nextWaiter = waiters.shift();
  if (nextWaiter) {
    // Hand this slot straight to the next waiter — `active` is unchanged
    // (one job's slot passed to the next), so there's no gap for another
    // caller to steal it.
    nextWaiter();
    return;
  }
  active = Math.max(0, active - 1);
}
