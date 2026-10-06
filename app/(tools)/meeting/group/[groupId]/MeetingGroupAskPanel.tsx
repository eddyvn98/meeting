"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { MeetingGroupAskAnswerCard, type GroupAskAnswer } from "./MeetingGroupAskAnswerCard";

const INPUT_MAX_HEIGHT_PX = 160;

/**
 * "Ask across this group" chat panel (MeetingGroupView.tsx) — same
 * continuous-conversation shape as MeetingAskTab.tsx, posting to
 * POST /api/meeting/groups/[groupId]/ask with the currently ticked
 * `selectedMeetingIds` instead of one meeting's id. The conversation is
 * local-only (not persisted, not cached across groupId like MeetingAskTab's
 * askAnswersCache) — this page is reached less often and a fresh
 * conversation per visit is simpler than the checklist/history interaction.
 */
export function MeetingGroupAskPanel({
	groupId,
	groupName,
	selectedMeetingIds,
}: {
	groupId: string;
	groupName: string;
	selectedMeetingIds: string[];
}) {
	const [question, setQuestion] = useState("");
	const [answers, setAnswers] = useState<GroupAskAnswer[]>([]);
	const [error, setError] = useState<string | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	// `pending` (derived from `answers` state) only reflects reality after a
	// render commits — a very fast double-invocation (e.g. Enter's key-repeat)
	// can call submit() twice before that happens. This ref is set/cleared
	// synchronously, closing that gap.
	const submittingRef = useRef(false);

	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT_PX)}px`;
	}, [question]);

	useEffect(() => {
		scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
	}, [answers]);

	const pending = answers.some((a) => a.pending);

	const submit = async () => {
		const q = question.trim();
		if (!q || pending || submittingRef.current) return;
		if (selectedMeetingIds.length === 0) {
			setError("Tick at least one meeting to ask about.");
			return;
		}
		submittingRef.current = true;
		setError(null);
		setQuestion("");

		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const history = answers.filter((a) => !a.pending).map((a) => ({ question: a.question, answer: a.answer }));
		setAnswers((prev) => [...prev, { id, question: q, answer: "", evidence: [], mocked: false, pending: true }]);

		try {
			const res = await fetch(`/api/meeting/groups/${groupId}/ask`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ question: q, meetingIds: selectedMeetingIds, history }),
			});
			if (!res.ok) throw new Error(`Ask failed (${res.status})`);
			const data = (await res.json()) as Omit<GroupAskAnswer, "id" | "pending">;
			setAnswers((prev) => prev.map((a) => (a.id === id ? { ...data, id, pending: false } : a)));
		} catch (err) {
			setAnswers((prev) => prev.filter((a) => a.id !== id));
			setError(err instanceof Error ? err.message : "Ask failed");
		} finally {
			submittingRef.current = false;
		}
	};

	return (
		<div className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-3">
			<div ref={scrollRef} className="flex-1 overflow-y-auto">
				{answers.length === 0 ? (
					<p className="py-8 text-center text-sm text-muted-foreground">
						Ask anything across the meetings ticked in "{groupName}" — evidence links back to
						whichever meeting it came from.
					</p>
				) : (
					<div className="flex flex-col gap-4 py-1">
						{answers.map((answer) => (
							<MeetingGroupAskAnswerCard key={answer.id} answer={answer} />
						))}
					</div>
				)}
			</div>

			{error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

			<div className="flex items-end gap-2 rounded-xl border border-border bg-background p-2">
				<textarea
					ref={textareaRef}
					value={question}
					onChange={(e) => setQuestion(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							submit();
						}
					}}
					placeholder="Ask across the ticked meetings…"
					rows={1}
					className="max-h-40 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
				/>
				<button
					type="button"
					onClick={submit}
					disabled={!question.trim() || pending}
					aria-label="Ask"
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-orange text-white disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Send className="h-4 w-4" />
				</button>
			</div>
		</div>
	);
}
