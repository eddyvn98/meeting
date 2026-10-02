"use client";

import { Languages } from "lucide-react";
import { TRANSLATE_LANGUAGES } from "@/lib/meeting/translateLanguages";
import { AUTO_OUTPUT_LANGUAGE, OUTPUT_LANGUAGE_STORAGE_KEY, getStoredOutputLanguage } from "@/lib/meeting/outputLanguage";

export { AUTO_OUTPUT_LANGUAGE as AUTO_MINUTES_LANGUAGE, getStoredOutputLanguage as getStoredMinutesLanguage };

const MINUTES_LANGUAGE_STORAGE_KEY = OUTPUT_LANGUAGE_STORAGE_KEY;

interface Props {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}

/** Language picker for "Generate with AI" — decides the language the AI writes the minutes in. */
export function MinutesLanguageSelect({ value, onChange, disabled }: Props) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Languages className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">Minutes language</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          try {
            localStorage.setItem(MINUTES_LANGUAGE_STORAGE_KEY, e.target.value);
          } catch {
            // Persisting the choice is best-effort.
          }
        }}
        className="rounded-md border border-border bg-background px-2 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
        title="Language the AI writes the minutes in"
      >
        <option value={AUTO_OUTPUT_LANGUAGE}>Auto (meeting language)</option>
        {TRANSLATE_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
