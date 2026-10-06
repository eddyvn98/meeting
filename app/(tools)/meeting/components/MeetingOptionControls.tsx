"use client";

import type { ReactNode } from "react";
import { ChevronDown, Cpu, Info, Zap } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { STT_LANGUAGES } from "@/lib/meeting/sttLanguages";
import { TRANSCRIPTION_MODES } from "@/lib/meeting/stt/transcriptionMode";
import type { MeetingOptions } from "./useMeetingOptions";

/** One settings line: label on the left, its control on the right. */
function OptionRow({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
	return (
		<div className="flex min-h-8 items-center justify-between gap-3">
			<span className="flex items-center gap-1 text-xs font-medium text-foreground">
				{label}
				{hint}
			</span>
			{children}
		</div>
	);
}

function SelectField({
	label,
	value,
	onChange,
	children,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	children: ReactNode;
}) {
	return (
		<span className="relative inline-flex">
			<select
				aria-label={label}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className="h-8 cursor-pointer appearance-none rounded-md border border-border bg-background pl-2.5 pr-7 text-xs text-foreground focus:border-brand-orange focus:outline-none"
			>
				{children}
			</select>
			<ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
		</span>
	);
}

export function LanguageControl({ options }: { options: MeetingOptions }) {
	return (
		<OptionRow label="Language">
			<SelectField label="Language" value={options.sttLanguage} onChange={options.changeLanguage}>
				{STT_LANGUAGES.map((lang) => (
					<option key={lang.code} value={lang.code}>
						{lang.label}
					</option>
				))}
			</SelectField>
		</OptionRow>
	);
}

/** Small "i" button explaining the two transcription models. Opens on tap, so it works on touch screens. */
function ModeInfo() {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button type="button" aria-label="About transcription models" className="rounded-full p-0.5 text-muted-foreground hover:text-foreground">
					<Info className="h-3.5 w-3.5" />
				</button>
			</PopoverTrigger>
			<PopoverContent className="w-72 space-y-3 p-3 text-left text-xs">
				{TRANSCRIPTION_MODES.map((option) => (
					<div key={option.mode}>
						<p className="flex items-center gap-1.5 font-semibold text-foreground">
							{option.mode === "fast" ? <Zap className="h-3.5 w-3.5 fill-amber-500 text-amber-500" /> : <Cpu className="h-3.5 w-3.5 text-emerald-500" />}
							{option.label}
						</p>
						<p className="mt-0.5 text-muted-foreground">{option.description}</p>
					</div>
				))}
				<p className="border-t border-border pt-2 text-muted-foreground">
					Fast uses the paid API for the live transcript and for the final transcript text (speakers are detected on our side). On phones, live transcription is always paid; when you end a recording we ask whether to process it for free on our server (low) or with the paid API. Uploads from a phone follow the model you pick here.
				</p>
			</PopoverContent>
		</Popover>
	);
}

/** `paidOnly` hides "low": phones only offer the paid model when recording. */
export function ModeControl({ options, paidOnly = false }: { options: MeetingOptions; paidOnly?: boolean }) {
	const visible = paidOnly ? TRANSCRIPTION_MODES.filter((o) => o.mode === "fast") : TRANSCRIPTION_MODES;
	return (
		<OptionRow label="Model" hint={<ModeInfo />}>
			<div className="inline-flex h-8 items-center rounded-md border border-border bg-muted/40 p-0.5" role="radiogroup" aria-label="Transcription model">
				{visible.map((option) => {
					const selected = paidOnly || options.transcriptionMode === option.mode;
					return (
						<button
							key={option.mode}
							type="button"
							role="radio"
							aria-checked={selected}
							onClick={() => options.changeMode(option.mode)}
							className={`flex h-full items-center gap-1 rounded px-2.5 text-xs transition-colors ${
								selected ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
							}`}
						>
							{option.mode === "fast" ? (
								<Zap className={`h-3 w-3 ${selected ? "fill-amber-500 text-amber-500" : ""}`} />
							) : (
								<Cpu className={`h-3 w-3 ${selected ? "text-emerald-500" : ""}`} />
							)}
							{option.label}
						</button>
					);
				})}
			</div>
		</OptionRow>
	);
}
