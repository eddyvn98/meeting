"use client";

import { useEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { MeetingAskAnswerCard, type AskAnswer } from "./MeetingAskAnswerCard";
import type { Point } from "@/lib/meeting/ui/bubblePosition";

// Module scope, not state — kept mounted (just hidden) while closed so a
// question in flight still lands and the unread badge on AskChatBubble can
// fire; this cache also means reopening never re-fetches. Keyed by
// meetingId so switching meetings doesn't cross-contaminate conversations.
const askAnswersCache = new Map<string, AskAnswer[]>();

const INPUT_MAX_HEIGHT_PX = 160;
const DESKTOP_BREAKPOINT_PX = 640;
const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 560;
const PANEL_GAP = 12;

function useIsDesktop() {
	const [isDesktop, setIsDesktop] = useState(false);
	useEffect(() => {
		const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT_PX}px)`);
		const update = () => setIsDesktop(mql.matches);
		update();
		mql.addEventListener("change", update);
		return () => mql.removeEventListener("change", update);
	}, []);
	return isDesktop;
}

/**
 * "Ask AI" chat surface — replaces the old Ask tab (MeetingAskTab.tsx /
 * MeetingAskSplitView.tsx). Reuses the same POST /api/meeting/[id]/ask call
 * and MeetingAskAnswerCard for rendering; only the shell (floating panel vs
 * bottom sheet, open/close, focus) is new. Always mounted — visibility is
 * toggled with CSS, not unmount/remount, so the conversation survives close
 * and AskChatBubble's unread badge can fire for an answer that completes
 * while the panel is closed.
 */
export function AskChatPanel({
	meetingId,
	open,
	onClose,
	onHistoryChange,
	onAnsweredWhileClosed,
	bubbleGeometry,
	returnFocusRef,
}: {
	meetingId: string;
	open: boolean;
	onClose: () => void;
	onHistoryChange?: (answers: AskAnswer[]) => void;
	onAnsweredWhileClosed?: () => void;
	bubbleGeometry: { position: Point; side: "left" | "right"; size: { width: number; height: number } } | null;
	returnFocusRef: { current: HTMLButtonElement | null };
}) {
	const isDesktop = useIsDesktop();
	const [question, setQuestion] = useState("");
	const [answers, setAnswers] = useState<AskAnswer[]>(() => askAnswersCache.get(meetingId) ?? []);
	const [error, setError] = useState<string | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const meetingIdRef = useRef(meetingId);
	const openRef = useRef(open);
	const touchStartYRef = useRef<number | null>(null);

	useEffect(() => { meetingIdRef.current = meetingId; }, [meetingId]);
	useEffect(() => { openRef.current = open; }, [open]);
	useEffect(() => { setAnswers(askAnswersCache.get(meetingId) ?? []); }, [meetingId]);

	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT_PX)}px`;
	}, [question]);

	useEffect(() => {
		if (!open) return;
		scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
	}, [answers, open]);

	useEffect(() => {
		onHistoryChange?.(answers);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [answers]);

	// Focus the input when the panel opens; return focus to the bubble when
	// it closes (accessibility requirement — keyboard/screen-reader users
	// shouldn't lose their place).
	useEffect(() => {
		if (open) {
			const id = requestAnimationFrame(() => textareaRef.current?.focus());
			return () => cancelAnimationFrame(id);
		}
		returnFocusRef.current?.focus();
	}, [open, returnFocusRef]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, onClose]);

	const applyToMeeting = (forMeetingId: string, updater: (prev: AskAnswer[]) => AskAnswer[]) => {
		const resolved = updater(askAnswersCache.get(forMeetingId) ?? []);
		askAnswersCache.set(forMeetingId, resolved);
		if (forMeetingId === meetingIdRef.current) setAnswers(resolved);
	};

	const pending = answers.some((a) => a.pending);

	const submit = async () => {
		const q = question.trim();
		if (!q || pending) return;
		const forMeetingId = meetingId;
		setError(null);
		setQuestion("");

		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const history = answers.filter((a) => !a.pending).map((a) => ({ question: a.question, answer: a.answer }));
		applyToMeeting(forMeetingId, (prev) => [...prev, { id, question: q, answer: "", evidence: [], mocked: false, pending: true }]);

		try {
			const res = await fetch(`/api/meeting/${forMeetingId}/ask`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ question: q, history }),
			});
			if (!res.ok) throw new Error(`Ask failed (${res.status})`);
			const data = (await res.json()) as Omit<AskAnswer, "id" | "pending">;
			applyToMeeting(forMeetingId, (prev) => prev.map((a) => (a.id === id ? { ...data, id, pending: false } : a)));
			if (!openRef.current || forMeetingId !== meetingIdRef.current) onAnsweredWhileClosed?.();
		} catch (err) {
			applyToMeeting(forMeetingId, (prev) => prev.filter((a) => a.id !== id));
			if (forMeetingId === meetingIdRef.current) setError(err instanceof Error ? err.message : "Ask failed");
		}
	};

	// Mobile bottom-sheet swipe-down-to-close.
	const onTouchStart = (e: React.TouchEvent) => { touchStartYRef.current = e.touches[0]?.clientY ?? null; };
	const onTouchMove = (e: React.TouchEvent) => {
		const start = touchStartYRef.current;
		if (start == null) return;
		const delta = (e.touches[0]?.clientY ?? start) - start;
		if (delta > 80) { touchStartYRef.current = null; onClose(); }
	};

	const desktopStyle: React.CSSProperties | undefined = isDesktop && bubbleGeometry
		? (() => {
				const { position, side, size } = bubbleGeometry;
				const maxTop = Math.max(PANEL_GAP, window.innerHeight - PANEL_HEIGHT - PANEL_GAP);
				const top = Math.min(Math.max(position.y + size.height / 2 - PANEL_HEIGHT / 2, PANEL_GAP), maxTop);
				// Prefer anchoring next to the bubble on its docked side, but
				// always clamp fully inside the viewport — `side` can be briefly
				// stale right after a resize, and this keeps the panel on-screen
				// either way instead of trusting it blindly.
				const preferredLeft = side === "right" ? position.x - PANEL_WIDTH - PANEL_GAP : position.x + size.width + PANEL_GAP;
				const maxLeft = Math.max(PANEL_GAP, window.innerWidth - PANEL_WIDTH - PANEL_GAP);
				const left = Math.min(Math.max(preferredLeft, PANEL_GAP), maxLeft);
				return { position: "fixed", top, left, width: PANEL_WIDTH, height: PANEL_HEIGHT } as React.CSSProperties;
			})()
		: undefined;

	return (
		<>
			<div
				aria-hidden
				onClick={onClose}
				className={`fixed inset-0 z-40 bg-black/30 transition-opacity motion-reduce:transition-none sm:bg-transparent ${
					open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
				}`}
			/>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-label="Ask AI chat"
				className={
					isDesktop
						? `z-40 flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl transition-all duration-200 motion-reduce:transition-none ${
								open ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0"
							}`
						: `fixed inset-x-0 bottom-0 z-40 flex h-[85vh] flex-col overflow-hidden rounded-t-2xl border-t border-border bg-card shadow-2xl transition-transform duration-200 motion-reduce:transition-none ${
								open ? "translate-y-0" : "pointer-events-none translate-y-full"
							}`
				}
				style={isDesktop ? desktopStyle : undefined}
				inert={!open ? true : undefined}
			>
				{!isDesktop && (
					<div onTouchStart={onTouchStart} onTouchMove={onTouchMove} className="flex shrink-0 justify-center pb-1 pt-2">
						<span className="h-1.5 w-10 rounded-full bg-muted" />
					</div>
				)}
				<div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
					<h2 className="text-sm font-semibold text-foreground">Ask AI</h2>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close Ask AI chat"
						className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
					{answers.length === 0 ? (
						<p className="py-8 text-center text-sm text-muted-foreground">
							Ask anything about this meeting — you can keep the conversation going, follow-up questions included.
						</p>
					) : (
						<div className="flex flex-col gap-4 py-1">
							{answers.map((answer) => (
								<MeetingAskAnswerCard key={answer.id} answer={answer} />
							))}
						</div>
					)}
				</div>

				{error && <p className="px-3 text-xs text-red-600 dark:text-red-400">{error}</p>}

				<div className="flex shrink-0 items-end gap-2 border-t border-border p-2">
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
						placeholder="Ask anything about this meeting…"
						rows={1}
						className="max-h-40 flex-1 resize-none overflow-y-auto rounded-lg bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
					/>
					<button
						type="button"
						onClick={submit}
						disabled={!question.trim() || pending}
						aria-label="Ask"
						className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:cursor-not-allowed disabled:opacity-50"
					>
						<Send className="h-4 w-4" />
					</button>
				</div>
			</div>
		</>
	);
}
