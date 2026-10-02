/**
 * lib/meeting/outputLanguage.ts
 *
 * The language AI-generated content (Minutes, and Overview sections) is
 * written in: a TRANSLATE_LANGUAGES code, or "auto" for the language the
 * meeting was recorded in.
 */

import { TRANSLATE_LANGUAGES, labelForTranslateLang } from "./translateLanguages";

export const AUTO_OUTPUT_LANGUAGE = "auto";

/** Shared by the Minutes picker and the Overview "Generate with AI" action, so
 *  one choice applies to both. */
export const OUTPUT_LANGUAGE_STORAGE_KEY = "meeting-minutes-language";

export function isOutputLanguageChoice(value: unknown): value is string {
  return value === AUTO_OUTPUT_LANGUAGE || TRANSLATE_LANGUAGES.some((l) => l.code === value);
}

export function getStoredOutputLanguage(): string {
  try {
    const stored = localStorage.getItem(OUTPUT_LANGUAGE_STORAGE_KEY);
    if (isOutputLanguageChoice(stored)) return stored;
  } catch {
    // localStorage unavailable — fall back to the default.
  }
  return AUTO_OUTPUT_LANGUAGE;
}

/** Server-side: turns the request's `language` into the language name to put in
 *  the prompt. `ok: false` means the value was not a supported choice;
 *  `label: undefined` means "let the AI follow the transcript's language". */
export function resolveOutputLanguage(requested: unknown, sttLanguage: string | null | undefined): { ok: true; label: string | undefined } | { ok: false } {
  const choice = requested === undefined ? AUTO_OUTPUT_LANGUAGE : requested;
  if (!isOutputLanguageChoice(choice)) return { ok: false };
  const code = choice === AUTO_OUTPUT_LANGUAGE ? sttLanguage : choice;
  return { ok: true, label: code && code !== "auto" ? labelForTranslateLang(code) : undefined };
}
