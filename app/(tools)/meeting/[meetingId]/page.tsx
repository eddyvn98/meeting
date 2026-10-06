"use client";

import { useCallback, useEffect, useState } from "react";
import { Radio, Users } from "lucide-react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import ProtectedRoute from "@/components/features/auth/protected-route";
import { useToolLayoutSlots } from "@/hooks/use-tool-layout-slots";
import { emitMeetingRenamed, onMeetingRenamed } from "@/lib/meeting/meetingEvents";
import { MeetingAside } from "../components/MeetingAside";
import type { MeetingDetail } from "@/lib/meeting/types";
import { MeetingResultHeader } from "./components/MeetingResultHeader";
import { MeetingTranslationControl } from "./components/MeetingTranslationControl";
import { MeetingDetailSkeleton } from "./components/MeetingDetailSkeleton";
import { MeetingMockResultBanner } from "./components/MeetingMockResultBanner";
import { MeetingAudioExpiryBanner } from "./components/MeetingAudioExpiryBanner";
import { MeetingAudioOnlyBanner } from "./components/MeetingAudioOnlyBanner";
import { isAudioOnlyResult } from "@/lib/meeting/audio/audioOnly";
import { computeAudioExpiry } from "@/lib/meeting/audioRetention";
import { useAudioRetentionDays } from "@/lib/meeting/useAudioRetentionDays";
import {
	MeetingResultTabs,
	type MeetingResultTab,
} from "./components/MeetingResultTabs";
import { MeetingOverviewTab } from "./components/MeetingOverviewTab";
import { MeetingTranscriptTab } from "./components/MeetingTranscriptTab";
import { AskChatBubble } from "./components/AskChatBubble";
import { AskChatPanel } from "./components/AskChatPanel";
import type { AskAnswer } from "./components/MeetingAskAnswerCard";
import { MeetingAudioPlayer } from "./components/MeetingAudioPlayer";
import { MeetingAudioSeekProvider } from "./components/MeetingAudioSeekContext";
import { useMeetingTranslation } from "./useMeetingTranslation";
import { useLiveMeetingTranscript } from "./useLiveMeetingTranscript";
import { useAskChatState } from "./useAskChatState";
import { meetingDetailCache } from "./meetingDetailCache";
import { useMeetingSegmentEditor } from "./useMeetingSegmentEditor";

const VALID_TABS: MeetingResultTab[] = ["overview", "transcript"];

/**
 * Meeting Result screen: tab shell (Overview / Transcript) + sticky audio
 * player, plus the floating AskChatBubble / AskChatPanel ("Ask AI" chat,
 * not a tab — see useAskChatState.ts). `?tab=ask` is a legacy deep link,
 * normalized into opening the chat panel instead.
 */
export default function MeetingResultPage() {
	const params = useParams<{ meetingId: string }>();
	const meetingId = params?.meetingId ?? "";
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const tabParam = searchParams.get("tab");
	const activeTab: MeetingResultTab = VALID_TABS.includes(tabParam as MeetingResultTab)
		? (tabParam as MeetingResultTab)
		: "overview";

	const [detail, setDetail] = useState<MeetingDetail | null>(null);
	const [error, setError] = useState<string | null>(null);
	// Ask AI conversation never persists server-side (see ask/route.ts) — kept
	// here so the Download menu can offer "include the Ask AI conversation".
	const [askAnswers, setAskAnswers] = useState<AskAnswer[]>([]);
	const askChat = useAskChatState({ tabParam, searchParams, pathname, replace: router.replace });
	const onLiveSegment = useCallback((segment: MeetingDetail["transcriptSegments"][number]) => {
		setDetail((previous) => {
			if (!previous || previous.transcriptSegments.some((item) => item.id === segment.id)) return previous;
			const next = { ...previous, transcriptSegments: [...previous.transcriptSegments, segment].sort((a, b) => a.order - b.order) };
			meetingDetailCache.set(meetingId, next);
			return next;
		});
	}, [meetingId]);
	const refreshLiveMeeting = useCallback((nextStatus: string) => {
		if (nextStatus !== "READY" && nextStatus !== "FAILED") return;
		void fetch(`/api/meeting/${meetingId}`, { cache: "no-store" })
			.then((response) => response.ok ? response.json() as Promise<MeetingDetail> : null)
			.then((next) => { if (next) { meetingDetailCache.set(meetingId, next); setDetail(next); } })
			.catch(() => undefined);
	}, [meetingId]);
	useLiveMeetingTranscript(meetingId, detail?.status, onLiveSegment, refreshLiveMeeting);

	const translation = useMeetingTranslation(meetingId, detail?.transcriptSegments ?? [], detail?.summary ?? null);
	const editSegment = useMeetingSegmentEditor({
		meetingId,
		detail,
		setDetail,
		dropSegmentTranslation: translation.dropSegmentTranslation,
	});
	const retentionDays = useAudioRetentionDays();
	const audioExpiry = detail && retentionDays !== null ? computeAudioExpiry(detail, retentionDays) : null;

	useEffect(() => {
		if (!meetingId) return;
		let cancelled = false;
		setError(null);
		// Show a cached copy immediately if we have one — otherwise fall back
		// to the skeleton. Either way, a fresh fetch still runs below so a
		// cached view gets silently revalidated rather than going stale.
		setDetail(meetingDetailCache.get(meetingId) ?? null);

		fetch(`/api/meeting/${meetingId}`)
			.then(async (res) => {
				if (!res.ok) throw new Error(`Failed to load meeting (${res.status})`);
				return (await res.json()) as MeetingDetail;
			})
			.then((data) => {
				if (cancelled) return;
				meetingDetailCache.set(meetingId, data);
				setDetail(data);
				// Always emit (not just when it differs from a previous cache
				// entry — there IS no previous entry on this meeting's very
				// first-ever visit, e.g. redirected here straight off the
				// Processing screen, which is exactly when an auto-title from
				// content is most likely to have just landed). MeetingAside's
				// listener patches its list in place either way, a no-op when
				// the title is already the same.
				emitMeetingRenamed(meetingId, data.title);
			})
			.catch((err) => {
				if (cancelled) return;
				// A stale cached view is still more useful than an error screen —
				// only surface the error if we have nothing at all to show.
				if (!meetingDetailCache.has(meetingId)) {
					setError(err instanceof Error ? err.message : "Failed to load meeting");
				}
			});

		return () => {
			cancelled = true;
		};
	}, [meetingId]);

	// Picks up a rename made from the sidebar's Recent list
	// (MeetingAsideRecentItem.tsx) — the reverse direction of the sync
	// MeetingResultHeader.tsx already does when renaming from here.
	useEffect(() => {
		return onMeetingRenamed((id, title) => {
			if (id !== meetingId) return;
			setDetail((prev) => {
				if (!prev) return prev;
				const next = { ...prev, title };
				meetingDetailCache.set(id, next);
				return next;
			});
		});
	}, [meetingId]);

	// transcript/route.ts marks the meeting READY as soon as the transcript
	// itself is saved, then generates the Overview summary + Vietnamese
	// translations in the background (so the redirect off the Processing
	// screen isn't stuck waiting on two more upstream LLM calls). Poll for
	// that summary to show up instead of leaving "Summary not ready yet"
	// frozen on a page the user already landed on.
	useEffect(() => {
		// An audio-only meeting has no transcript, so no summary is coming.
		if (!meetingId || !detail || detail.summary || isAudioOnlyResult(detail)) return;
		let cancelled = false;
		const id = setInterval(() => {
			fetch(`/api/meeting/${meetingId}`, { cache: "no-store" })
				.then((res) => (res.ok ? (res.json() as Promise<MeetingDetail>) : null))
				.then((data) => {
					if (cancelled || !data?.summary) return;
					meetingDetailCache.set(meetingId, data);
					setDetail(data);
					// Same reasoning as the initial fetch above — this poll is
					// exactly what catches an auto-title landing while you're
					// already sitting on the page.
					emitMeetingRenamed(meetingId, data.title);
				})
				.catch(() => undefined);
		}, 4000);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [meetingId, detail]);

	const handleTabChange = useCallback(
		(tab: MeetingResultTab) => {
			const next = new URLSearchParams(searchParams.toString());
			if (tab === "overview") next.delete("tab");
			else next.set("tab", tab);
			const query = next.toString();
			router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
		},
		[pathname, router, searchParams],
	);

	useToolLayoutSlots({
		showHistory: false,
		aside: <MeetingAside />,
	});

	return (
		<ProtectedRoute>
			<div className="flex h-full w-full flex-col bg-background">
				{error ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
						<p className="text-sm font-medium text-foreground">
							Couldn&apos;t load this meeting
						</p>
						<p className="text-sm text-muted-foreground">{error}</p>
					</div>
				) : !detail ? (
					<MeetingDetailSkeleton />
				) : (
					<MeetingAudioSeekProvider>
						<MeetingResultHeader
							meetingId={meetingId}
							title={detail.title}
							createdAt={detail.createdAt}
							durationSec={detail.durationSec}
							speakerCount={detail.speakers.length}
							audioUrl={detail.audioUrl}
							segments={detail.transcriptSegments}
							summary={detail.summary}
							askAnswers={askAnswers}
							audioExpiry={audioExpiry}
							mindmapBoardId={detail.mindmapBoardId}
							onRenamed={(title) =>
								setDetail((prev) => {
									if (!prev) return prev;
									const next = { ...prev, title };
									meetingDetailCache.set(meetingId, next);
									return next;
								})
							}
							accessRole={detail.accessRole}
							translationControl={
								<MeetingTranslationControl
									mode={translation.languageMode}
									onChange={translation.setLanguageMode}
									targetLang={translation.targetLang}
									onTargetLangChange={translation.setTargetLang}
									needsTranslation={translation.needsTranslation}
									hasAnyTranslation={translation.hasAnyTranslation}
									translating={translation.translating}
									translateError={translation.translateError}
									onTranslate={translation.translate}
								/>
							}
						/>
						{detail.isLive && (
							<div className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 sm:mx-6">
								<div className="flex min-w-0 items-center gap-3">
									<span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
										<Radio className="h-4 w-4" />
										<span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background animate-pulse" />
									</span>
									<div className="min-w-0">
										<p className="text-sm font-semibold text-foreground">Shared live STT room</p>
										<p className="text-xs text-muted-foreground">
											Everyone with meeting access sees the same live transcript.
										</p>
									</div>
								</div>
								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<Users className="h-3.5 w-3.5" />
									<span>{detail.participantNames.length > 0 ? `${detail.participantNames.length} participants detected` : "Participants syncing"}</span>
								</div>
							</div>
						)}
						<MeetingAudioPlayer audioUrl={detail.audioUrl} meetingTitle={detail.title} audioExpiry={audioExpiry} />
						{detail.isMockResult && <MeetingMockResultBanner meetingId={meetingId} />}
						<MeetingAudioExpiryBanner meeting={detail} />
						<div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
							{isAudioOnlyResult(detail) && detail.transcriptSegments.length === 0 && (
								<MeetingAudioOnlyBanner meetingId={meetingId} failureReason={detail.failureReason} canRetry={detail.accessRole === "owner"} />
							)}
							{activeTab === "overview" && !(isAudioOnlyResult(detail) && detail.transcriptSegments.length === 0) && (
								<MeetingOverviewTab
									summary={translation.displaySummary}
									segments={detail.transcriptSegments}
									meetingId={meetingId}
									accessRole={detail.accessRole}
									editingDisabled={translation.languageMode !== "en"}
									sourceSummary={detail.summary}
									onSummaryChange={(updater) =>
										setDetail((prev) => {
											if (!prev || !prev.summary) return prev;
											const next = { ...prev, summary: updater(prev.summary) };
											meetingDetailCache.set(meetingId, next);
											return next;
										})
									}
								/>
							)}
							{activeTab === "transcript" && (
								<MeetingTranscriptTab
									meetingId={meetingId}
									segments={translation.displaySegments}
									speakers={detail.speakers}
									speakerMappings={detail.speakerMappings}
									participantNames={detail.participantNames}
									languageMode={translation.languageMode}
									canEdit={detail.accessRole === "owner" || detail.accessRole === "editor"}
									onSegmentEdit={editSegment}
								/>
							)}
						</div>
						<MeetingResultTabs activeTab={activeTab} onChange={handleTabChange} />
						<AskChatBubble
							open={askChat.open}
							hasUnread={askChat.unread}
							onTap={askChat.toggle}
							onGeometryChange={askChat.setBubbleGeometry}
							buttonRef={askChat.buttonRef} />
						<AskChatPanel
							meetingId={meetingId}
							open={askChat.open}
							onClose={() => askChat.setOpen(false)}
							onHistoryChange={setAskAnswers}
							onAnsweredWhileClosed={askChat.onAnsweredWhileClosed}
							bubbleGeometry={askChat.bubbleGeometry}
							returnFocusRef={askChat.buttonRef}
						/>
					</MeetingAudioSeekProvider>
				)}
			</div>
		</ProtectedRoute>
	);
}
