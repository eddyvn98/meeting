import type { ReactNode } from "react";

/** Wraps every Meeting page in the `.meeting-app` scope (neutral focus
 *  ring override in globals.css). `contents` keeps the wrapper out of the
 *  layout tree so it can't affect flex/grid sizing. The client-side STT models
 *  are NOT loaded here — they load only when local transcription is actually
 *  used (see lib/meeting/stt/preloadStt.ts warmSttModelsInBackground). */
export default function MeetingLayout({ children }: { children: ReactNode }) {
	return <div className="meeting-app contents">{children}</div>;
}
