export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse one RFC-style byte range. Multiple ranges are deliberately rejected:
 * the Meeting audio endpoint streams one contiguous file segment per request.
 *
 * Returns null for malformed or unsatisfiable ranges. An end beyond EOF is
 * clipped to EOF, as clients commonly send open/oversized final ranges.
 */
export function parseSingleByteRange(range: string, size: number): ByteRange | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return {
      start: Math.max(0, size - suffixLength),
      end: size - 1,
    };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) return null;

  if (!rawEnd) return { start, end: size - 1 };

  const requestedEnd = Number(rawEnd);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;

  return {
    start,
    end: Math.min(requestedEnd, size - 1),
  };
}
