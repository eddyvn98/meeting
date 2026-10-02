"use client";

import { Languages, Loader2 } from "lucide-react";
import { labelForTranslateLang } from "@/lib/meeting/translateLanguages";
import { MeetingTranslationToggle, type MeetingTranslationToggleProps } from "./MeetingTranslationToggle";

/**
 * Header translation control: the Original / target-language / Bilingual
 * switch plus the "Translate to X" action, so both are reachable from the
 * Overview and Transcript tabs alike. The action only appears while a
 * translated view is selected and something is still untranslated.
 */
export function MeetingTranslationControl({
	needsTranslation,
	hasAnyTranslation,
	translating,
	translateError,
	onTranslate,
	...toggleProps
}: MeetingTranslationToggleProps & {
	needsTranslation: boolean;
	hasAnyTranslation: boolean;
	translating: boolean;
	translateError: string | null;
	onTranslate: () => void;
}) {
	const showAction = toggleProps.mode !== "en" && needsTranslation;
	const targetLabel = labelForTranslateLang(toggleProps.targetLang);

	return (
		<div className="flex flex-wrap items-center justify-end gap-2">
			{showAction && (
				<button
					type="button"
					onClick={onTranslate}
					disabled={translating}
					title={hasAnyTranslation ? "Some lines are still untranslated" : `No ${targetLabel} translation has been generated yet`}
					className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
				>
					{translating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
					{translating ? "Translating…" : hasAnyTranslation ? "Retry missing lines" : `Translate to ${targetLabel}`}
				</button>
			)}
			<MeetingTranslationToggle {...toggleProps} disabled={toggleProps.disabled || translating} />
			{translateError && <p className="basis-full text-right text-xs text-red-600 dark:text-red-400">{translateError}</p>}
		</div>
	);
}
