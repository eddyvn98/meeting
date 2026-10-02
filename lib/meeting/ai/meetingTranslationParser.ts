/**
 * lib/meeting/ai/meetingTranslationParser.ts
 *
 * Pure parsing for the Vietnamese-translation JSON array the meeting agent
 * (difyMeetingAgent.ts generateVietnameseTranslations) is asked to return —
 * one line in, one line out, same order as the English segments sent to it.
 * Split from the network call so alignment logic (a translation array
 * shorter/longer than the input, or not JSON at all) is unit-testable
 * without mocking fetch.
 */

/** Extracts the first JSON array or object out of raw agent text, unwrapping
 *  a ```json fence first if present. Returns null if nothing plausible is
 *  found (a bracket/brace pair). */
function extractJsonValue(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;

  const arrayStart = candidate.indexOf("[");
  const objectStart = candidate.indexOf("{");
  const useArray = arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart);

  const start = useArray ? arrayStart : objectStart;
  const end = useArray ? candidate.lastIndexOf("]") : candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Returns a `expectedCount`-length array of Vietnamese translations aligned
 * by index to the English segments the caller sent, or null if the agent's
 * response has no usable translation data at all — including when it comes
 * back with a different number of lines than expected, since there is no
 * reliable way to tell which line(s) the model dropped/merged/reordered,
 * and silently returning a length-forced array would attach translations to
 * the wrong transcript lines for every index after the mismatch. The caller
 * (meetingTranslationAgent.ts's translateChunk) treats a null return as a
 * failure and bisects into smaller chunks to retry.
 *
 * A translation that is present but not a string or blank still becomes
 * `null` at that index (caller leaves `TranscriptSegment.textVi` unset for
 * it) rather than failing the whole batch — a partial translation of an
 * otherwise correctly-aligned batch is still useful.
 */
export function parseTranslations(raw: string, expectedCount: number): (string | null)[] | null {
  if (expectedCount === 0) return null;
  const parsed = extractJsonValue(raw);

  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).translations)
      ? ((parsed as Record<string, unknown>).translations as unknown[])
      : null;
  if (!list) return null;
  if (list.length !== expectedCount) return null;

  return list.map((value) => (typeof value === "string" && value.trim() ? value.trim() : null));
}
