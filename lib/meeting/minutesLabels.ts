/**
 * lib/meeting/minutesLabels.ts
 *
 * The fixed wording of the printed minutes (section headings, table headers,
 * footer labels, empty-state lines). A translated language version carries its
 * own copy of these, so a Vietnamese version prints with Vietnamese headings
 * and not only Vietnamese matters.
 */

export const MINUTES_LABEL_DEFAULTS = {
  meetingDate: "Meeting Date",
  meetingTime: "Meeting Time",
  meetingVenue: "Meeting Venue",
  attendance: "Attendance",
  minutes: "Minutes",
  name: "Name",
  role: "Role",
  organization: "Organization",
  presentRegrets: "Present / Regrets",
  serialNumber: "S/N",
  matterDiscussed: "Matter Discussed",
  actionToBeTaken: "Action to be taken (Duration, Deadline)",
  responsible: "Responsible",
  recordedBy: "Recorded by",
  date: "Date",
  distributed: "Distributed",
  ongoing: "Ongoing",
  noAttendees: "No attendees recorded.",
  noMinutes: "No minutes have been recorded yet.",
  noDetails: "No details recorded.",
} as const;

export type MinutesLabelKey = keyof typeof MINUTES_LABEL_DEFAULTS;
export type MinutesLabels = Record<MinutesLabelKey, string>;
export type MinutesLabelOverrides = Partial<Record<MinutesLabelKey, string>>;

export const MINUTES_LABEL_KEYS = Object.keys(MINUTES_LABEL_DEFAULTS) as MinutesLabelKey[];

/** English defaults with any (translated) overrides applied. Blank overrides are ignored. */
export function resolveMinutesLabels(overrides?: MinutesLabelOverrides | null): MinutesLabels {
  const labels: MinutesLabels = { ...MINUTES_LABEL_DEFAULTS };
  if (!overrides) return labels;
  for (const key of MINUTES_LABEL_KEYS) {
    const value = overrides[key];
    if (typeof value === "string" && value.trim()) labels[key] = value.trim();
  }
  return labels;
}
