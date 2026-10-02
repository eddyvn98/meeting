/**
 * lib/meeting/ai/batchLines.ts
 *
 * Long meetings produce transcripts well past what fits in one agent prompt
 * (difyMeetingAgent.ts's old MAX_TRANSCRIPT_CHARS=12,000 cutoff) — a single
 * call used to just truncate and silently drop everything after that point
 * (confirmed live: a 91-segment meeting's Overview summary translation came
 * back empty because it was concatenated after the transcript and fell past
 * the cutoff). These two helpers replace "one big call that truncates" with
 * "several calls, each under budget, run concurrently, reassembled in order"
 * for translation/insights generation (see difyMeetingAgent.ts).
 */

/** Greedily groups `items` into chunks whose {@link getText} lengths sum to
 *  at most `budgetChars` per chunk — never splits a single item across two
 *  chunks (an individual item longer than the whole budget just gets its
 *  own oversized chunk rather than being cut mid-item). */
export function chunkByCharBudget<T>(items: T[], getText: (item: T) => string, budgetChars: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;

  for (const item of items) {
    const len = getText(item).length;
    if (current.length > 0 && currentChars + len > budgetChars) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += len;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Runs `worker` over every item with at most `limit` in flight at once —
 *  a long meeting can split into a dozen+ chunks, and firing them all at
 *  the exact same instant risks the upstream agent's own rate limits more
 *  than it saves wall-clock time.
 *
 *  Every current caller's `worker` already treats `null` as "this chunk
 *  failed" and degrades gracefully around it (see meetingTranslationAgent.ts/
 *  meetingInsightsAgent.ts) — but neither worker itself is written to catch
 *  its own errors, it's just an invariant they happen to uphold today. If a
 *  future change let one throw instead, an unwrapped `Promise.all` here
 *  would fail the ENTIRE batch, discarding every other chunk that already
 *  finished successfully. Catching per-item makes that failure mode
 *  impossible regardless of what any individual worker does. */
export async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    const index = nextIndex++;
    if (index >= items.length) return;
    try {
      results[index] = await worker(items[index], index);
    } catch (err) {
      console.warn(`[meeting] runWithConcurrency: item ${index} failed, treating as a missing result:`, err);
      results[index] = null as R;
    }
    return runNext();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}
