/**
 * lib/meeting/bilingualText.ts
 *
 * Bilingual Overview text is one string: the original, this separator, then
 * the translation. Cards render it with <BilingualText>; anything that does
 * not still shows the translation on its own line.
 */

export const BILINGUAL_SEPARATOR = "\u2063\n";

export function joinBilingual(original: string, translated: string): string {
  return `${original}${BILINGUAL_SEPARATOR}${translated}`;
}

export function splitBilingual(text: string): { original: string; translated: string | null } {
  const index = text.indexOf(BILINGUAL_SEPARATOR);
  if (index === -1) return { original: text, translated: null };
  return { original: text.slice(0, index), translated: text.slice(index + BILINGUAL_SEPARATOR.length) };
}
