"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
	TRANSLATE_LANGUAGES,
	labelForTranslateLang,
} from "@/lib/meeting/translateLanguages";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type TranscriptLanguageMode = "en" | "vi" | "bilingual";

export interface MeetingTranslationToggleProps {
	mode: TranscriptLanguageMode;
	onChange: (mode: TranscriptLanguageMode) => void;
	targetLang: string;
	onTargetLangChange: (lang: string) => void;
	disabled?: boolean;
}

/**
 * Translation display control shared by the Overview and Transcript tabs:
 *  - [Original]: Shows the source text.
 *  - [Target Language ▾]: Shows the translated text, and lets the user choose
 *    the target language from a dropdown menu.
 *  - [ ] Bilingual: separate checkbox that shows original and translated text
 *    together. Unticking it returns to the translated view.
 */
export function MeetingTranslationToggle({
	mode,
	onChange,
	targetLang,
	onTargetLangChange,
	disabled = false,
}: MeetingTranslationToggleProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	const translatedLabel = labelForTranslateLang(targetLang);

	return (
		<div className="inline-flex items-center rounded-lg border border-border bg-muted p-0.5">
			{/* 1. Original text mode */}
			<button
				type="button"
				disabled={disabled}
				onClick={() => {
					if (!disabled) onChange("en");
				}}
				className={cn(
					"rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
					mode === "en"
						? "bg-card font-semibold text-brand-orange shadow-sm"
						: "text-muted-foreground hover:text-foreground"
				)}
				aria-pressed={mode === "en"}
			>
				Original
			</button>

			{/* 2. Target language selector & translated mode toggle */}
			<div
				className={cn(
					"inline-flex items-center rounded-md transition-colors",
					mode === "vi"
						? "bg-card font-semibold text-brand-orange shadow-sm"
						: "text-muted-foreground hover:text-foreground"
				)}
			>
				<button
					type="button"
					disabled={disabled}
					onClick={() => {
						if (disabled) return;
						if (mode !== "vi") {
							onChange("vi");
						} else {
							setMenuOpen((v) => !v);
						}
					}}
					className="py-1.5 pl-3 pr-1 text-xs font-[inherit] disabled:cursor-not-allowed disabled:opacity-50"
					aria-pressed={mode === "vi"}
				>
					{translatedLabel} · AI
				</button>
				<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							disabled={disabled}
							aria-label="Select translation language"
							className="py-1.5 pl-0.5 pr-2 text-xs opacity-70 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
						>
							<ChevronDown className="h-3.5 w-3.5" />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="center" className="max-h-60 overflow-y-auto">
						{TRANSLATE_LANGUAGES.map((lang) => (
							<DropdownMenuItem
								key={lang.code}
								disabled={disabled}
								onClick={() => {
									if (disabled) return;
									onTargetLangChange(lang.code);
									if (mode === "en") {
										onChange("vi");
									}
								}}
								className={cn(
									"flex cursor-pointer items-center justify-between text-xs",
									lang.code === targetLang && "font-semibold text-brand-orange"
								)}
							>
								<span>{lang.label}</span>
								{lang.code === targetLang && (
									<Check className="h-3.5 w-3.5 text-brand-orange" />
								)}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			{/* 3. Bilingual checkbox (independent of the two buttons above) */}
			<label
				className={cn(
					"ml-1 inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
					mode === "bilingual" ? "text-brand-orange" : "text-muted-foreground hover:text-foreground",
					disabled && "cursor-not-allowed opacity-50"
				)}
			>
				<input
					type="checkbox"
					disabled={disabled}
					checked={mode === "bilingual"}
					onChange={(event) => onChange(event.target.checked ? "bilingual" : "vi")}
					className="h-3.5 w-3.5 accent-brand-orange"
				/>
				Bilingual
			</label>
		</div>
	);
}
