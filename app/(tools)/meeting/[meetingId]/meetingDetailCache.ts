import type { MeetingDetail } from "@/lib/meeting/types";

// Keep per-tab detail state across meeting-page navigation.
export const meetingDetailCache = new Map<string, MeetingDetail>();
