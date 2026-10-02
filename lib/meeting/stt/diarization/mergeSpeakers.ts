/**
 * lib/meeting/stt/diarization/mergeSpeakers.ts
 *
 * STT (Whisper) and diarization (pyannote) segment the same audio
 * independently and disagree on boundaries, so utterances can't be zipped
 * by index — this assigns each STT segment the diarization speakerIndex
 * with the greatest time overlap. An STT segment with no overlapping
 * diarization span (silence-only diarization output, or diarization
 * unavailable entirely) falls back to `speakerIndex: 0` — a single implied
 * speaker is the pre-diarization behavior, so this never regresses when
 * diarization can't run.
 *
 * Pure (no model/audio) so it's unit-testable with synthetic segments.
 */

export interface TimeRange {
  start: number;
  end: number;
}

export interface DiarizedSpan extends TimeRange {
  speakerIndex: number;
}

function overlapSeconds(a: TimeRange, span: DiarizedSpan): number {
  const start = Math.max(a.start, span.start);
  const end = Math.min(a.end, span.end);
  return Math.max(0, end - start);
}

/** Returns one speakerIndex per input segment, in the same order. */
export function assignSpeakerIndexes<T extends TimeRange>(segments: T[], spans: DiarizedSpan[]): number[] {
  if (spans.length === 0) return segments.map(() => 0);

  return segments.map((segment) => {
    let bestIndex = 0;
    let bestOverlap = 0;
    for (const span of spans) {
      const overlap = overlapSeconds(segment, span);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIndex = span.speakerIndex;
      }
    }
    return bestOverlap > 0 ? bestIndex : 0;
  });
}
