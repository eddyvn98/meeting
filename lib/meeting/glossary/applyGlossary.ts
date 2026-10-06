/**
 * lib/meeting/glossary/applyGlossary.ts
 *
 * Applies a user's personal glossary (MeetingGlossaryTerm — domain jargon,
 * product names, acronyms) two ways:
 *   - correctTranscriptText: a fuzzy nearest-match pass over raw STT output,
 *     replacing a mis-heard word or short word-run with its glossary
 *     spelling — e.g. the single word "Dofy" for "Dify", or a multi-word
 *     term like "hot desk" mis-transcribed as "hot disk". A single-token
 *     glossary term matches one word at a time; a multi-token term tries a
 *     sliding window of nearby word counts, comparing the window's combined
 *     letters/digits against the term's own. This is orthographic (edit-
 *     distance) matching, not phonetic — it catches a close misspelling or
 *     a dropped/added space or symbol, but NOT a phrase STT reconstructed
 *     with a materially different (if similar-sounding) wording, such as an
 *     inserted extra word (a multi-word name heard differently won't match: the
 *     inserted "and" alone exceeds the edit-distance budget a 6-letter term
 *     tolerates). That would need phonetic matching (soundex/metaphone),
 *     which this does not attempt.
 *   - glossaryContextBlock: a short "known terms" list appended to the
 *     translation/Ask-agent prompts so the AI stays consistent with the
 *     term's canonical spelling instead of re-deriving it from context.
 */

import { levenshtein } from "./levenshtein";

export interface GlossaryTerm {
  term: string;
  note: string | null;
}

const WORD_RE = /[\p{L}\p{N}]+(?:[''-][\p{L}\p{N}]+)*/gu;
const ALNUM_ONLY_RE = /[^\p{L}\p{N}]/gu;

/** Max edit distance to accept a fuzzy match, scaled to the compared
 *  string's length — a short term (e.g. "SQL") tolerates 1 edit, a longer
 *  one a bit more, so this never over-corrects a short common word/phrase
 *  into unrelated jargon. */
function maxDistanceFor(normalized: string): number {
  return Math.max(1, Math.floor(normalized.length / 5));
}

function normalize(s: string): string {
  return s.toLowerCase().replace(ALNUM_ONLY_RE, "");
}

interface CompiledTerm {
  term: string;
  /** Word count when the term itself is split by WORD_RE —
   *  becomes 2 ("ONG", "ONG"); "Dify" stays 1. This is the window size a
   *  matching mis-heard run must have in the transcript text. */
  tokenCount: number;
  normalized: string;
}

function compileTerms(glossary: GlossaryTerm[]): CompiledTerm[] {
  return glossary.map(({ term }) => ({
    term,
    tokenCount: Math.max(1, term.match(WORD_RE)?.length ?? 1),
    normalized: normalize(term),
  }));
}

/** Replaces each word or short word-run in `text` that closely matches a
 *  glossary term with the term's canonical spelling. An exact (normalized)
 *  match is left untouched — nothing to correct. Multi-token terms are
 *  tried first at each position (longest window first) so a phrase match
 *  wins over accidentally also matching one of its own words against an
 *  unrelated single-token term. */
export function correctTranscriptText(text: string, glossary: GlossaryTerm[]): string {
  if (glossary.length === 0 || !text) return text;

  const compiled = compileTerms(glossary).sort((a, b) => b.tokenCount - a.tokenCount);
  const matches = Array.from(text.matchAll(WORD_RE));
  if (matches.length === 0) return text;

  let result = "";
  let cursor = 0;
  let i = 0;

  while (i < matches.length) {
    const wordStart = matches[i].index as number;
    // "replacement": actually correct the window to the term's spelling.
    // "skip": the window already matches (any casing) — advance past it
    // untouched, rather than falling through to the single-word loop and
    // re-examining its later words on their own.
    type Outcome =
      | { kind: "replacement"; term: string; endMatchIndex: number; windowSize: number; distance: number }
      | { kind: "skip"; endMatchIndex: number };
    let outcome: Outcome | null = null;

    // Best-fit, not first-fit: when two glossary terms of the same token
    // count both clear the fuzzy-match threshold at this position (e.g.
    // "Dofa" and "Dify" both within edit-distance-1 of a mis-transcribed
    // "Dofy"), the ORIGINAL glossary order used to decide silently — even
    // if the other candidate were a strictly closer (or exact) match. This
    // scans every candidate at this position and keeps the closest one,
    // preferring a longer matched window (a phrase match still wins over a
    // shorter one, same as before) and, among equal window sizes, the
    // smallest edit distance. An exact match is unbeatable, so it still
    // short-circuits immediately.
    termLoop: for (const ct of compiled) {
      // STT can add or drop a small word (e.g. an inserted "and") when it
      // mis-hears a multi-word/symbol-bearing term, so the matching window
      // isn't always exactly the term's own token count — try a small
      // range around it instead of only the exact size.
      const minTokens = Math.max(1, ct.tokenCount - 1);
      const maxTokens = ct.tokenCount + 1;
      for (let windowSize = minTokens; windowSize <= maxTokens; windowSize++) {
        if (i + windowSize > matches.length) continue;
        const windowMatches = matches.slice(i, i + windowSize);
        const windowStart = windowMatches[0].index as number;
        const lastMatch = windowMatches[windowMatches.length - 1];
        const windowEnd = (lastMatch.index as number) + lastMatch[0].length;
        const windowNormalized = normalize(text.slice(windowStart, windowEnd));
        const endMatchIndex = i + windowSize - 1;

        if (windowNormalized === ct.normalized) {
          outcome = { kind: "skip", endMatchIndex };
          break termLoop;
        }
        const threshold = maxDistanceFor(ct.normalized);
        if (Math.abs(windowNormalized.length - ct.normalized.length) > threshold) continue;

        const distance = levenshtein(windowNormalized, ct.normalized);
        if (distance <= threshold) {
          const isBetter =
            !outcome ||
            outcome.kind !== "replacement" ||
            windowSize > outcome.windowSize ||
            (windowSize === outcome.windowSize && distance < outcome.distance);
          if (isBetter) {
            outcome = { kind: "replacement", term: ct.term, endMatchIndex, windowSize, distance };
          }
        }
      }
    }

    if (outcome?.kind === "replacement") {
      const lastMatch = matches[outcome.endMatchIndex];
      const spanEnd = (lastMatch.index as number) + lastMatch[0].length;
      result += text.slice(cursor, wordStart) + outcome.term;
      cursor = spanEnd;
      i = outcome.endMatchIndex + 1;
    } else if (outcome?.kind === "skip") {
      i = outcome.endMatchIndex + 1;
    } else {
      i += 1;
    }
  }
  result += text.slice(cursor);
  return result;
}

/** null when there's nothing to add — callers should skip appending an
 *  empty section to their prompt rather than adding a "Known terms:" header
 *  with nothing under it. */
export function glossaryContextBlock(glossary: GlossaryTerm[]): string | null {
  if (glossary.length === 0) return null;
  const lines = glossary.map((g) => (g.note ? `${g.term} (${g.note})` : g.term));
  return `Known terms/jargon used in this domain — spell and use these exactly as given, do not "correct" them to a more common word:\n${lines.join(", ")}`;
}
