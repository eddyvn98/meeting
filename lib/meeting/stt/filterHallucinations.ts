/**
 * lib/meeting/stt/filterHallucinations.ts
 *
 * Whisper commonly hallucinates on audio with no real speech (silence, room tone,
 * background noise):
 * 1. Repeated punctuation-only tokens (e.g. "..", ".", "...").
 * 2. YouTube boilerplate subtitles ("thanks for watching", subscribe prompts, etc.).
 *
 * This filter drops punctuation-only segments and segments whose normalized text
 * consists entirely of known hallucination boilerplate phrases.
 */

const HAS_ALPHANUMERIC = /[\p{L}\p{N}]/u;

function stripAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0111\u0110]/g, "d")
    .replace(/[\u01a1\u01a0]/g, "o")
    .replace(/[\u01b0\u01af]/g, "u")
    .replace(/[\u2018\u2019]/g, "'");
}

/**
 * Known Whisper boilerplate hallucinations on silence, room noise, or music.
 * Matched against the entire normalized utterance (with optional punctuation).
 */
const HALLUCINATION_PATTERNS: RegExp[] = [
  // Vietnamese YouTube/subtitle boilerplates (accent-stripped)
  /\bghien\s*mi\s*go\b/i,
  /\bsubscribe\s+cho\s+kenh\b/i,
  /\bdang\s*ky\s*kenh\b/i,
  /\bbam\s*chuong\s*thong\s*bao\b/i,
  /\blike\s+va\s+sub\b/i,
  /\bcam\s*on\s*cac\s*ban\s*da\s*(xem|theo\s*doi)/i,
  /\bhen\s*gap\s*lai\s*cac\s*ban\b/i,
  /\bchuc\s*cac\s*ban\s*(xem\s*video|vui\s*ve)\b/i,
  /\bdung\s*quen\s*(like|sub|dang\s*ky)\b/i,
  // English YouTube boilerplates
  /\bthank(s)?\s+for\s+watching\b/i,
  /\bplease\s+subscribe\b/i,
  /\blike\s+and\s+subscribe\b/i,
  /\bdon't\s+forget\s+to\s+subscribe\b/i,
  /\bsee\s+you\s+in\s+the\s+next\s+video\b/i,
  /\bleave\s+a\s+like\b/i,
];

export function isMeaningfulSttText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || !HAS_ALPHANUMERIC.test(trimmed)) {
    return false;
  }
  // Strip surrounding punctuation and whitespace for anchored boilerplate matching
  const normalized = stripAccents(trimmed)
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "")
    .replace(/\s+/g, " ");

  for (const pattern of HALLUCINATION_PATTERNS) {
    if (pattern.test(normalized)) {
      return false;
    }
  }
  return true;
}
