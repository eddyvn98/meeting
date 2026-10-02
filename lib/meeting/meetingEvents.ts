/**
 * Tiny cross-component pub/sub for meeting changes that need to reach the
 * sidebar's Recent list immediately instead of waiting for its own next
 * fetch (MeetingAside.tsx's meetings list only refetches on `pathname`
 * change, which doesn't fire when a title is edited in place on the result
 * page — see MeetingResultHeader.tsx's commit()).
 */

type MeetingRenamedListener = (meetingId: string, title: string) => void;

const listeners = new Set<MeetingRenamedListener>();

export function emitMeetingRenamed(meetingId: string, title: string): void {
	for (const listener of listeners) listener(meetingId, title);
}

export function onMeetingRenamed(listener: MeetingRenamedListener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Same idea as the rename pub/sub above, for "a new meeting now exists" —
 *  MeetingAside.tsx's Recent list only fetches once on mount (see its own
 *  doc comment), so the record flow (useMeetingRecorder.ts) and the upload
 *  flow (fileUploadPipeline.ts) call this right after creating the row
 *  server-side, instead of the sidebar re-fetching its whole list on every
 *  navigation just to notice one new row most of the time didn't change. */
type MeetingsChangedListener = () => void;

const changedListeners = new Set<MeetingsChangedListener>();

export function emitMeetingsChanged(): void {
	for (const listener of changedListeners) listener();
}

export function onMeetingsChanged(listener: MeetingsChangedListener): () => void {
	changedListeners.add(listener);
	return () => changedListeners.delete(listener);
}
