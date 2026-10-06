"use client";

import { useState, type ReactNode } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TRANSLATE_LANGUAGES } from "@/lib/meeting/translateLanguages";
import { AUTO_OUTPUT_LANGUAGE, OUTPUT_LANGUAGE_STORAGE_KEY } from "@/lib/meeting/outputLanguage";

interface Props {
  /** Selected output language code, or "auto" for the meeting's own language. */
  language: string;
  onLanguageChange: (code: string) => void;
  generating: boolean;
  /** True when a minutes table already exists, so generating replaces it. */
  hasExisting: boolean;
  onGenerate: () => void;
  /** "icon" is the compact toolbar button (tooltip), "button" a labeled call to action. */
  variant: "icon" | "button";
}

/** One entry point for AI generation: the language choice lives inside it, so
 *  it is clear the language only decides what the AI writes. */
export function MinutesGenerateMenu({ language, onLanguageChange, generating, hasExisting, onGenerate, variant }: Props) {
  const [open, setOpen] = useState(false);
  const label = generating ? "Generating minutes…" : "Generate with AI";
  const icon: ReactNode = generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />;

  const trigger =
    variant === "icon" ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={generating}
              aria-label={label}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {icon}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    ) : (
      <PopoverTrigger asChild>
        <button type="button" disabled={generating} className="inline-flex items-center gap-1.5 rounded-md bg-brand-orange px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
          {icon} {label}
        </button>
      </PopoverTrigger>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {trigger}
      <PopoverContent align="end" className="w-72 space-y-3 p-3 text-left text-sm">
        <div>
          <p className="font-semibold text-foreground">Generate minutes with AI</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Drafts the minutes table from the transcript.{hasExisting ? " This replaces the current table." : ""}
          </p>
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
          Write minutes in
          <select
            value={language}
            onChange={(e) => {
              onLanguageChange(e.target.value);
              try {
                localStorage.setItem(OUTPUT_LANGUAGE_STORAGE_KEY, e.target.value);
              } catch {
                // Persisting the choice is best-effort.
              }
            }}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm font-normal text-foreground"
          >
            <option value={AUTO_OUTPUT_LANGUAGE}>Same language as the meeting</option>
            {TRANSLATE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onGenerate();
          }}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-orange px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
        >
          <Sparkles className="h-3.5 w-3.5" /> Generate
        </button>
      </PopoverContent>
    </Popover>
  );
}
