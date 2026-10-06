/** Shared response and request shapes for the Meeting Minutes view. */
import type { AttendanceSectionItem } from "./overviewSections";

export interface MeetingMinutes {
  id: string | null;
  meetingId: string;
  title: string | null;
  meetingDate: string | null;
  timeRange: string | null;
  venue: string | null;
  footnote: string | null;
  recordedBy: string | null;
  recordedDate: string | null;
  distributed: string | null;
  isDefault: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  attendanceSuggestions: AttendanceSuggestion[];
  attendanceDefaults: AttendanceSectionItem[];
  knownPeople: AttendanceSuggestion[];
}

export interface UpdateMeetingMinutesInput {
  title?: string | null;
  meetingDate?: string | null;
  timeRange?: string | null;
  venue?: string | null;
  footnote?: string | null;
  recordedBy?: string | null;
  recordedDate?: string | null;
  distributed?: string | null;
}

export interface AttendanceSuggestion {
  name: string;
  role: string | null;
  organization: string | null;
}
