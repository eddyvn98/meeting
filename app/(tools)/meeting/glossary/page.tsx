"use client";

import { useEffect, useState } from "react";
import { BookOpen, Loader2, Plus, Trash2 } from "lucide-react";
import ProtectedRoute from "@/components/features/auth/protected-route";
import { useToolLayoutSlots } from "@/hooks/use-tool-layout-slots";
import { MeetingAside } from "../components/MeetingAside";

interface GlossaryTerm {
	id: string;
	term: string;
	note: string | null;
	createdAt: string;
}

/**
 * Personal glossary management (spec follow-up: "personal dictionary for
 * domain jargon/terms so STT and translation get them right"). Reused
 * across every meeting the caller processes — not scoped to one meeting —
 * see lib/meeting/glossary/applyGlossary.ts for how it's actually applied
 * (a fuzzy correction pass on raw STT output, plus context appended to the
 * translation/Ask-agent prompts).
 */
export default function MeetingGlossaryPage() {
	useToolLayoutSlots({ showHistory: false, aside: <MeetingAside /> });

	const [terms, setTerms] = useState<GlossaryTerm[] | null>(null);
	const [term, setTerm] = useState("");
	const [note, setNote] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = () => {
		fetch("/api/meeting/glossary")
			.then((res) => (res.ok ? (res.json() as Promise<GlossaryTerm[]>) : null))
			.then((data) => {
				if (data) setTerms(data);
			})
			.catch(() => undefined);
	};

	useEffect(load, []);

	const handleAdd = async () => {
		const trimmed = term.trim();
		if (!trimmed || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const res = await fetch("/api/meeting/glossary", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ term: trimmed, note: note.trim() || null }),
			});
			if (!res.ok) throw new Error(`Failed (${res.status})`);
			setTerm("");
			setNote("");
			load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to add term");
		} finally {
			setSubmitting(false);
		}
	};

	const handleDelete = async (id: string) => {
		setTerms((prev) => prev?.filter((t) => t.id !== id) ?? prev);
		await fetch(`/api/meeting/glossary/${id}`, { method: "DELETE" }).catch(() => undefined);
	};

	return (
		<ProtectedRoute>
			<div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
				<div className="flex items-center gap-2">
					<BookOpen className="h-5 w-5 text-brand-orange" />
					<div>
						<h1 className="text-lg font-semibold text-foreground">Personal Glossary</h1>
						<p className="text-sm text-muted-foreground">
							Domain jargon, product names, or acronyms. Used to auto-correct transcription mistakes and keep
							translations/Ask AI answers consistent across every meeting you process.
						</p>
					</div>
				</div>

				<div className="rounded-xl border border-border bg-card p-4">
					<div className="flex flex-col gap-2 sm:flex-row">
						<input
							value={term}
							onChange={(e) => setTerm(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && handleAdd()}
							placeholder="Term (e.g. Acme, Dify, kanban)"
							className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
						/>
						<input
							value={note}
							onChange={(e) => setNote(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && handleAdd()}
							placeholder="Note (optional)"
							className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
						/>
						<button
							type="button"
							onClick={handleAdd}
							disabled={submitting || !term.trim()}
							className="flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-brand-orange px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
						>
							{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
							Add
						</button>
					</div>
					{error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
				</div>

				<div className="rounded-xl border border-border bg-card">
					{terms === null ? (
						<p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</p>
					) : terms.length === 0 ? (
						<p className="px-4 py-8 text-center text-sm text-muted-foreground">
							No terms yet. Add one above to get started.
						</p>
					) : (
						<ul className="divide-y divide-border">
							{terms.map((t) => (
								<li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
									<div className="min-w-0">
										<p className="truncate text-sm font-medium text-foreground">{t.term}</p>
										{t.note && <p className="truncate text-xs text-muted-foreground">{t.note}</p>}
									</div>
									<button
										type="button"
										onClick={() => handleDelete(t.id)}
										aria-label={`Remove ${t.term}`}
										className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-red-600 dark:hover:text-red-400"
									>
										<Trash2 className="h-3.5 w-3.5" />
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</ProtectedRoute>
	);
}
