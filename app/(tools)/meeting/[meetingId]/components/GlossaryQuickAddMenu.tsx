"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

export interface GlossaryQuickAddState {
	x: number;
	y: number;
	term: string;
}

const MENU_WIDTH = 288;

/**
 * Floating popover shown after right-clicking a text selection in the
 * transcript (see useGlossaryQuickAdd.ts) — lets the user add that phrase
 * to their personal glossary (lib/meeting/glossary/applyGlossary.ts)
 * without leaving the page. The term/note are editable in place before
 * saving, since the selected text is a starting point (e.g. STT may have
 * captured it slightly wrong), not necessarily the exact spelling to store.
 */
export function GlossaryQuickAddMenu({
	state,
	onClose,
}: {
	state: GlossaryQuickAddState;
	onClose: () => void;
}) {
	const [term, setTerm] = useState(state.term);
	const [note, setNote] = useState("");
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const onDocMouseDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("mousedown", onDocMouseDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("mousedown", onDocMouseDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [onClose]);

	const save = async () => {
		const trimmed = term.trim();
		if (!trimmed) return;
		setSaving(true);
		try {
			const res = await fetch("/api/meeting/glossary", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ term: trimmed, note: note.trim() || undefined }),
			});
			if (res.ok) {
				setSaved(true);
				setTimeout(onClose, 700);
			}
		} finally {
			setSaving(false);
		}
	};

	const left = typeof window === "undefined" ? state.x : Math.min(state.x, Math.max(8, window.innerWidth - MENU_WIDTH - 8));

	return (
		<div
			ref={ref}
			style={{ top: state.y, left, width: MENU_WIDTH }}
			className="fixed z-50 rounded-lg border border-border bg-card p-3 shadow-lg"
		>
			{saved ? (
				<p className="flex items-center gap-1.5 text-sm text-foreground">
					<Check className="h-4 w-4 text-green-600" /> Added to glossary
				</p>
			) : (
				<>
					<p className="mb-2 text-xs font-medium text-muted-foreground">Add to personal glossary</p>
					<input
						value={term}
						onChange={(e) => setTerm(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && save()}
						autoFocus
						placeholder="Term"
						className="mb-1.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none"
					/>
					<input
						value={note}
						onChange={(e) => setNote(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && save()}
						placeholder="Note (optional)"
						className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none"
					/>
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={onClose}
							className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={save}
							disabled={saving || !term.trim()}
							className="rounded-md bg-brand-orange px-2.5 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
						>
							{saving ? "Saving…" : "Add"}
						</button>
					</div>
				</>
			)}
		</div>
	);
}
