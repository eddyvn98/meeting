import type { ReactNode } from "react";

/** Scopes Meeting styles without adding an identity or module restriction. */
export default function MeetingLayout({ children }: { children: ReactNode }) {
	return <div className="meeting-app contents">{children}</div>;
}
