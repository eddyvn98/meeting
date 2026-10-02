import type { Metadata } from "next";
import type { ReactNode } from "react";

/** The share token lives in the URL, so keep it out of search indexes and out
 *  of the Referer header sent to any link opened from the page. */
export const metadata: Metadata = {
  title: "Meeting minutes",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PublicMeetingViewLayout({ children }: { children: ReactNode }) {
  return children;
}
