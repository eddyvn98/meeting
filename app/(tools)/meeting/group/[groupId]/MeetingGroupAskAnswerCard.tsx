"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { formatClock } from "@/lib/meeting/format";
import MessageFormatterServer from "@/lib/markdown/MessageFormatter.server";

export interface GroupAskEvidence {
	meetingId: string;
	meetingTitle: string;
	segmentId: string;
	timestampMs: number;
	quote: string;
}

export interface GroupAskAnswer {
	id: string;
	question: string;
	answer: string;
	evidence: GroupAskEvidence[];
	mocked: boolean;
	pending?: boolean;
}

/**
 * One turn of the group's "Ask across this group" conversation — same chat
 * bubble layout as MeetingAskAnswerCard.tsx, except each evidence line also
 * names which meeting it's from and links to that meeting's page instead of
 * seeking a shared audio player (there isn't one on this page — the
 * meetings involved aren't all loaded here).
 */
export function MeetingGroupAskAnswerCard({ answer }: { answer: GroupAskAnswer }) {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex justify-end">
				<p className="max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-orange px-3.5 py-2 text-sm text-white">
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
										<Link
											key={e.segmentId}
											href={`/meeting/${e.meetingId}`}
											className="flex items-start gap-2 text-left text-xs hover:text-foreground"
										>
											<span className="shrink-0 font-medium text-brand-orange">
												{e.meetingTitle} · {formatClock(e.timestampMs)}
											</span>
											<span className="text-muted-foreground">{e.quote}</span>
										</Link>
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
