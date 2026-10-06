/**
 * lib/meeting/translateLanguages.ts
 *
 * Target-language list for the Transcript tab's "Translate" button
 * (MeetingTranscriptTab.tsx) — previously hardcoded to Vietnamese only.
 * `code` "vi" is the one persisted server-side (TranscriptSegment.textVi,
 * the only translated-text column that exists) — every other language is
 * translated on demand and cached client-side only for the session (same
 * pattern the tab already used for Vietnamese before this file existed),
 * since adding a column per language isn't warranted for this list's size.
 */

export interface TranslateLanguage {
  code: string;
  label: string;
}

// Supports common meeting languages across Southeast Asia and other regions.
export const TRANSLATE_LANGUAGES: TranslateLanguage[] = [
  { code: "vi", label: "Vietnamese" },
  { code: "en", label: "English" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "fr", label: "French" },
  { code: "ms", label: "Malay" },
  { code: "id", label: "Indonesian" },
  { code: "tl", label: "Filipino" },
  { code: "th", label: "Thai" },
  { code: "my", label: "Burmese" },
  { code: "mn", label: "Mongolian" },
  { code: "hi", label: "Hindi" },
  { code: "ar", label: "Arabic" },
];

export const DEFAULT_TRANSLATE_LANG = "vi";

/** Remembers the user's last-picked target language across meetings. */
export const TRANSLATE_LANG_STORAGE_KEY = "meeting-translate-lang";

/** Remembers the user's last-picked transcript language mode across meetings. */
export const TRANSLATE_MODE_STORAGE_KEY = "meeting-transcript-language-mode";

export function labelForTranslateLang(code: string): string {
  return TRANSLATE_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

export function getStoredTranslateLang(): string {
  if (typeof window === "undefined") return "Vietnamese";
  try {
    const stored = localStorage.getItem(TRANSLATE_LANG_STORAGE_KEY) || DEFAULT_TRANSLATE_LANG;
    return labelForTranslateLang(stored);
  } catch {
    return "Vietnamese";
  }
}

export function setStoredTranslateLang(labelOrCode: string): void {
  if (typeof window === "undefined") return;
  try {
    const lang = TRANSLATE_LANGUAGES.find(
      (l) => l.label.toLowerCase() === labelOrCode.toLowerCase() || l.code.toLowerCase() === labelOrCode.toLowerCase(),
    );
    localStorage.setItem(TRANSLATE_LANG_STORAGE_KEY, lang?.code || labelOrCode);
  } catch {
    // Ignore localStorage write error
  }
}
