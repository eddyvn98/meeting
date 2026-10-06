import { useCallback, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import type { MeetingDetail } from "@/lib/meeting/types";
import { meetingDetailCache } from "./meetingDetailCache";

export function useMeetingSegmentEditor({
	meetingId,
	detail,
	setDetail,
	dropSegmentTranslation,
}: {
	meetingId: string;
	detail: MeetingDetail | null;
	setDetail: Dispatch<SetStateAction<MeetingDetail | null>>;
	dropSegmentTranslation: (segmentId: string) => void;
}) {
	return useCallback(async (segmentId: string, text: string) => {
		const previous = detail?.transcriptSegments.find((segment) => segment.id === segmentId);
		if (!previous || !text.trim() || text === previous.textEn) return;

		const apply = (textEn: string | null, textVi: string | null) =>
			setDetail((current) => {
				if (!current) return current;
				const next = {
					...current,
					transcriptSegments: current.transcriptSegments.map((segment) =>
						segment.id === segmentId ? { ...segment, textEn, textVi } : segment,
					),
				};
				meetingDetailCache.set(meetingId, next);
				return next;
			});

		apply(text, null);
		dropSegmentTranslation(segmentId);
		try {
			const response = await fetch(`/api/meeting/${meetingId}/segments/${segmentId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text }),
			});
			if (!response.ok) {
				const data = (await response.json().catch(() => null)) as { error?: string } | null;
				throw new Error(data?.error ?? `Request failed (${response.status})`);
			}
		} catch (error) {
			apply(previous.textEn, previous.textVi);
			toast.error(error instanceof Error ? error.message : "Could not save the change");
		}
	}, [detail, dropSegmentTranslation, meetingId, setDetail]);
}
