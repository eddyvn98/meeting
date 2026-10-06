"use client";

import { useSearchParams } from "next/navigation";
import ProtectedRoute from "@/components/features/auth/protected-route";
import { useToolLayoutSlots } from "@/hooks/use-tool-layout-slots";
import { MeetingAside } from "../components/MeetingAside";
import { RecordingScreen } from "./RecordingScreen";

function defaultTitle(): string {
  return `Meeting - ${new Date().toLocaleString()}`;
}

/** Recording Screen route (spec section 6). Reached from the Home screen's
 *  "Start Meeting" button; ?title= carries the meeting name entered there
 *  (falls back to a timestamped default). */
export default function MeetingRecordPage() {
  const searchParams = useSearchParams();
  const title = searchParams?.get("title")?.trim() || defaultTitle();

  useToolLayoutSlots({ showHistory: false, aside: <MeetingAside /> });

  return (
    <ProtectedRoute>
      <div className="h-full w-full overflow-y-auto bg-background">
        <RecordingScreen title={title} />
      </div>
    </ProtectedRoute>
  );
}
