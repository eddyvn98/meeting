"use client";

import type { MeetingMinutes } from "@/lib/meeting/types";
import type { MinutesHeaderFields } from "@/lib/meeting/minutesTypes";
import { resolveMinutesLabels, type MinutesLabels } from "@/lib/meeting/minutesLabels";

const fieldClass =
  "w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm text-foreground outline-none read-only:cursor-default focus:border-primary focus:bg-background print:border-none";

function Field({
  label,
  value,
  canEdit,
  onChange,
  placeholder,
}: {
  label: string;
  value: string | null;
  canEdit: boolean;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        className={fieldClass}
        value={value ?? ""}
        readOnly={!canEdit}
        onChange={(e) => onChange(e.target.value)}
        placeholder={canEdit ? placeholder : "—"}
      />
    </div>
  );
}

/**
 * MOM document title + "Meeting Date / Meeting Time / Meeting Venue"
 * header block. Every field is owner-editable via `onChange` (debounced
 * autosave lives in useMinutesEditor.ts, not here); read-only for a viewer.
 */
export function MinutesHeader({
  minutes,
  canEdit,
  onChange,
  labels = resolveMinutesLabels(),
}: {
  minutes: MeetingMinutes;
  canEdit: boolean;
  onChange: (field: keyof MinutesHeaderFields, value: string) => void;
  labels?: MinutesLabels;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border pb-4">
      <input
        className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-center text-lg font-bold uppercase tracking-wide text-foreground outline-none read-only:cursor-default focus:border-primary focus:bg-background print:border-none"
        value={minutes.title ?? ""}
        readOnly={!canEdit}
        onChange={(e) => onChange("title", e.target.value)}
        placeholder="MINUTES OF <MEETING TITLE>"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={labels.meetingDate} value={minutes.meetingDate} canEdit={canEdit} onChange={(v) => onChange("meetingDate", v)} placeholder="e.g. 23 Sep 2026" />
        <Field label={labels.meetingTime} value={minutes.timeRange} canEdit={canEdit} onChange={(v) => onChange("timeRange", v)} placeholder="e.g. 09:00 - 10:30" />
        <Field label={labels.meetingVenue} value={minutes.venue} canEdit={canEdit} onChange={(v) => onChange("venue", v)} placeholder="e.g. Room 401 / Online" />
      </div>
    </div>
  );
}
