"use client";

import { useState } from "react";
import { AlertTriangle, Languages, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { TRANSLATE_LANGUAGES } from "@/lib/meeting/translateLanguages";
import type { MinutesTranslation } from "@/lib/meeting/minutesTranslation";
import { ORIGINAL_VERSION } from "../useMinutesTranslations";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Confirm = { kind: "retranslate" | "delete"; language: string; label: string } | null;

/** Language versions of the minutes: the original plus any translated copies.
 *  Pick one to show it (Print and Download follow what is shown). Owners and
 *  editors can add a language (the AI translates the current minutes), and
 *  re-translate or delete a copy. */
export function MinutesLanguageBar({
  translations,
  active,
  translating,
  canEdit,
  onSelect,
  onAdd,
  onRetranslate,
  onDelete,
}: {
  translations: MinutesTranslation[];
  active: string;
  translating: string | null;
  canEdit: boolean;
  onSelect: (language: string) => void;
  onAdd: (language: string) => void;
  onRetranslate: (language: string) => void;
  onDelete: (language: string) => void;
}) {
  const [confirm, setConfirm] = useState<Confirm>(null);
  const current = translations.find((t) => t.language === active) ?? null;
  const addable = TRANSLATE_LANGUAGES.filter((l) => !translations.some((t) => t.language === l.code));
  if (translations.length === 0 && !canEdit) return null;

  const tab = (language: string, label: string, stale = false) => (
    <button
      key={language}
      type="button"
      onClick={() => onSelect(language)}
      aria-pressed={active === language}
      disabled={translating !== null}
      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
        active === language ? "bg-card text-brand-orange shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      {stale && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Out of date" aria-label="Out of date" />}
    </button>
  );

  return (
    <div className="mx-auto mt-3 flex w-full max-w-4xl flex-col gap-2 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <Languages className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5" role="group" aria-label="Minutes language">
          {tab(ORIGINAL_VERSION, "Original")}
          {translations.map((t) => tab(t.language, `${t.label} · AI`, t.stale))}
        </div>
        {translating ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> AI translating…
          </span>
        ) : (
          canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted">
                  <Plus className="h-3.5 w-3.5" /> Translate with AI
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                {addable.map((l) => (
                  <DropdownMenuItem key={l.code} onSelect={() => onAdd(l.code)}>
                    Translate to {l.label} with AI
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        )}
      </div>

      {current && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
          <p className={`flex items-center gap-1.5 ${current.stale ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
            {current.stale && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
            {current.stale ? `The original changed after this AI-generated ${current.label} translation was created.` : `${current.label} · AI — translated from the original.${canEdit ? " You can edit it." : ""}`}
          </p>
          {canEdit && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setConfirm({ kind: "retranslate", language: current.language, label: current.label })}
                disabled={translating !== null}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Translate again with AI
              </button>
              <button
                type="button"
                onClick={() => setConfirm({ kind: "delete", language: current.language, label: current.label })}
                aria-label={`Delete the ${current.label} version`}
                title="Delete this version"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === "delete" ? `Delete the ${confirm.label} · AI version?` : `Translate to ${confirm?.label} again with AI?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "delete"
                ? "This removes only this language version. The original minutes are not affected."
                : "AI will create a fresh translation from the original and replace this version, discarding any edits you made to it."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm?.kind === "delete") onDelete(confirm.language);
                else if (confirm) onRetranslate(confirm.language);
                setConfirm(null);
              }}
            >
              {confirm?.kind === "delete" ? "Delete" : `Translate to ${confirm?.label ?? ""} with AI`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
