/**
 * lib/meeting/stt/diarization/powersetDecode.ts
 *
 * pyannote/segmentation-3.0 (see localDiarizationProvider.ts) is a
 * "powerset" model: each of its output classes represents one SUBSET of
 * concurrently-active local speakers (the empty subset = silence/no active
 * speaker), not one speaker directly. transformers.js's own
 * `post_process_speaker_diarization` helper (feature_extraction_pyannote.js)
 * returns segments labeled by raw class id — this module decodes that id
 * back into which local speaker slot(s) are active, using pyannote.audio's
 * own class-ordering convention (`pyannote/audio/utils/powerset.py`):
 * classes are every subset of {0..numLocalSpeakers-1} of size 0..
 * maxConcurrentSpeakers, ordered first by increasing subset size, then in
 * combinations() order within each size. E.g. numLocalSpeakers=3,
 * maxConcurrentSpeakers=2 gives the model's actual default 7-class layout:
 * [[], [0], [1], [2], [0,1], [0,2], [1,2]].
 *
 * Pure and independent of any model/audio so it can be unit-tested directly
 * against the known class layout instead of a live model.
 */

function combinations(items: number[], size: number): number[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [first, ...rest] = items;
  const withFirst = combinations(rest, size - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, size);
  return [...withFirst, ...withoutFirst];
}

/** Builds the ordered list of powerset classes for a given local-speaker
 *  count and max concurrent speakers per frame. `classes[id]` is the list
 *  of active local speaker indexes for that class id (empty = silence). */
export function buildPowersetClasses(numLocalSpeakers: number, maxConcurrentSpeakers: number): number[][] {
  const indices = Array.from({ length: numLocalSpeakers }, (_, i) => i);
  const classes: number[][] = [];
  for (let size = 0; size <= maxConcurrentSpeakers; size++) {
    classes.push(...combinations(indices, size));
  }
  return classes;
}

/**
 * Decodes a single powerset class id into active local speaker indexes.
 * Returns `[]` for silence/no-speech, or an out-of-range id (defensive —
 * only reached if the model's actual class count doesn't match the
 * `numLocalSpeakers`/`maxConcurrentSpeakers` assumption, in which case
 * treating it as silence is safer than guessing a speaker).
 */
export function decodePowersetId(
  id: number,
  numLocalSpeakers: number,
  maxConcurrentSpeakers: number,
): number[] {
  const classes = buildPowersetClasses(numLocalSpeakers, maxConcurrentSpeakers);
  return classes[id] ?? [];
}

/** Total class count for a given (numLocalSpeakers, maxConcurrentSpeakers)
 *  pair — used by the provider to sanity-check the loaded model's actual
 *  `id2label` size before trusting the decode (see localDiarizationProvider
 *  .ts doc comment for what happens on a mismatch). */
export function powersetClassCount(numLocalSpeakers: number, maxConcurrentSpeakers: number): number {
  return buildPowersetClasses(numLocalSpeakers, maxConcurrentSpeakers).length;
}
