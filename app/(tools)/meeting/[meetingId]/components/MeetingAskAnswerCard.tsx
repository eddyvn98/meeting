"use client";

import { Loader2 } from "lucide-react";
import { formatClock } from "@/lib/meeting/format";
import { useMeetingAudioSeek } from "./MeetingAudioSeekContext";
import MessageFormatterServer from "@/lib/markdown/MessageFormatter.server";

export interface AskEvidence {
	segmentId: string;
	timestampMs: number;
	quote: string;
}

export interface AskAnswer {
	id: string;
	question: string;
	answer: string;
	evidence: AskEvidence[];
	mocked: boolean;
	pending?: boolean;
}

/**
 * One turn of the "Ask this meeting" conversation, rendered as a chat bubble
 * pair (question right-aligned, answer left-aligned) so a running back-
 * and-forth reads like a normal chat panel instead of numbered report
 * cards — see MeetingAskTab.tsx, which keeps every turn in one continuous
 * scrolling list and resends prior turns as context for follow-ups.
 * `mocked` is true only when the shared Dify Agent couldn't answer (not
 * configured / upstream failure) and the backend fell back to a
 * keyword-search placeholder (see app/api/meeting/[meetingId]/ask/route.ts)
 * — surfaced as a visible badge so that fallback is never mistaken for a
 * real AI answer. Evidence timestamps are real transcript references either
 * way and seek the shared audio player on click.
 */
export function MeetingAskAnswerCard({ answer }: { answer: AskAnswer }) {
	const { seekTo } = useMeetingAudioSeek();

	return (
		<div className="flex flex-col gap-2">
			<div className="flex justify-end">
				<p className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 text-sm text-white">
					{answer.question}
				</p>
			</div>

			<div className="flex justify-start">
				<div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-border bg-card px-3.5 py-2.5">
					{answer.pending ? (
						<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
					) : (
						<>
							{answer.mocked && (
								<span className="mb-1.5 inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
									Preview answer — no LLM wired up yet
								</span>
							)}
							<div className="text-sm text-foreground [&_.message-content]:my-0">
								<MessageFormatterServer content={answer.answer} skipFileDetect />
							</div>

							{answer.evidence.length > 0 && (
								<div className="mt-2.5 flex flex-col gap-1.5 border-t border-border pt-2.5">
									<p className="text-xs font-medium text-muted-foreground">Evidence</p>
									{answer.evidence.map((e) => (
										<button
											key={e.segmentId}
											type="button"
											onClick={() => seekTo(e.timestampMs)}
											className="flex items-start gap-2 text-left text-xs hover:text-foreground"
										>
											<span className="shrink-0 font-medium text-primary">
												{formatClock(e.timestampMs)}
											</span>
											<span className="text-muted-foreground">{e.quote}</span>
										</button>
									))}
								</div>
							)}
						</>
					)}
				</div>
			</div>
		</div>
	);
}
