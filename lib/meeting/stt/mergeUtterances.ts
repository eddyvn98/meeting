/**
 * lib/meeting/stt/mergeUtterances.ts
 *
 * Whisper's return_timestamps chunking (see serverWhisperProvider.ts /
 * localWhisperProvider.ts's chunk_length_s) emits a new segment every few
 * seconds regardless of sentence or pause boundaries — mid-sentence breaks
 * that read as choppy/disorganized in the Transcript tab. Merges adjacent
 * same-speaker raw chunks into natural utterances, splitting only on a real
 * pause (silence gap), a speaker change, sentence-ending punctuation, or a
 * length cap — so a speaker's long monologue still gets a fresh clickable
 * timestamp every MAX_UTTERANCE_SECONDS instead of becoming one giant block.
 *
 * Runs once, client-side, in runLocalMeetingProcessing.ts right before the
 * transcript is persisted — after diarization has already tagged each raw
 * chunk with a speakerIndex, so this is the first point both the local and
 * server STT tiers share a common shape to merge on.
 */

const MAX_GAP_SECONDS = 1.0;
const MAX_UTTERANCE_SECONDS = 25;
const SENTENCE_END_RE = /[.!?…]["')\]]?\s*$/;

export interface SpeakerTaggedSegment {
  start: number;
  end: number;
  text: string;
  speakerIndex: number;
}

export function mergeUtterances<T extends SpeakerTaggedSegment>(segments: T[]): T[] {
  if (segments.length === 0) return segments;

  const merged: T[] = [];
  let current: T = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    const next = segments[i];
    const gapSeconds = next.start - current.end;
    const sameSpeaker = next.speakerIndex === current.speakerIndex;
    const wouldBeTooLong = next.end - current.start > MAX_UTTERANCE_SECONDS;
    const currentEndsSentence = SENTENCE_END_RE.test(current.text);

    if (sameSpeaker && gapSeconds < MAX_GAP_SECONDS && !wouldBeTooLong && !currentEndsSentence) {
      current = { ...current, end: next.end, text: `${current.text} ${next.text}`.trim() };
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return merged;
}
