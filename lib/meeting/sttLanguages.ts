/**
 * lib/meeting/sttLanguages.ts
 *
 * Source-language list for the "before you record" language picker
 * (MeetingHome.tsx) — reuses the same language set as
 * translateLanguages.ts's target-language list,
 * with English added since Whisper needs an explicit language and this
 * deployment's meetings are as often English as Vietnamese.
 *
 * Whisper does NOT auto-detect language when none is given — omitting it
 * silently defaults generation to English regardless of the audio's actual
 * language (see localWhisperProvider.ts / serverWhisperProvider.ts) — so the
 * chosen code here is what actually gets passed to the model, not a display
 * label only.
 */

export interface SttLanguage {
  code: string;
  label: string;
}

/** Real per-chunk language auto-detection — see detectWhisperLanguage.ts for
 *  how "auto" is handled (whisper.cpp supports it natively; the
 *  Transformers.js branches run a custom detection step). */
export const AUTO_STT_LANG = "auto";

export const STT_LANGUAGES: SttLanguage[] = [
  { code: AUTO_STT_LANG, label: "Auto (detect)" },
  { code: "en", label: "English" },
  { code: "vi", label: "Vietnamese" },
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

/** Used until the user picks a language; their choice is then stored and wins. */
export const DEFAULT_STT_LANG = AUTO_STT_LANG;

/** Remembers the user's last-picked recording language across meetings —
 *  same pattern as TRANSLATE_LANG_STORAGE_KEY. */
export const STT_LANG_STORAGE_KEY = "meeting-stt-lang";

export function labelForSttLang(code: string): string {
  return STT_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

export function isValidSttLang(code: string): boolean {
  return STT_LANGUAGES.some((l) => l.code === code);
}

/** Reads the last-picked language from localStorage, falling back to
 *  DEFAULT_STT_LANG. Safe to call during SSR (returns the default). */
export function getStoredSttLang(): string {
  if (typeof window === "undefined") return DEFAULT_STT_LANG;
  try {
    const stored = window.localStorage.getItem(STT_LANG_STORAGE_KEY);
    if (stored && isValidSttLang(stored)) return stored;
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_STT_LANG;
}

export function setStoredSttLang(code: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STT_LANG_STORAGE_KEY, code);
  } catch {
    // Best-effort — a blocked/full localStorage just means the picker
    // resets to the default next visit, not a functional failure.
  }
}

/** Upload flow keeps its own language so it never mirrors the record flow. */
export const UPLOAD_STT_LANG_STORAGE_KEY = "meeting-upload-stt-lang";

export function getStoredUploadSttLang(): string {
  if (typeof window === "undefined") return DEFAULT_STT_LANG;
  try {
    const stored = window.localStorage.getItem(UPLOAD_STT_LANG_STORAGE_KEY);
    return stored && isValidSttLang(stored) ? stored : DEFAULT_STT_LANG;
  } catch {
    return DEFAULT_STT_LANG;
  }
}

export function setStoredUploadSttLang(code: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(UPLOAD_STT_LANG_STORAGE_KEY, code);
  } catch {
    // Best-effort persistence only.
  }
}
