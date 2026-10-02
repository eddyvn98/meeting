"use client";

import type { MeetingMinutes } from "@/lib/meeting/types";
import type { MinutesHeaderFields } from "@/lib/meeting/minutesTypes";
import { resolveMinutesLabels, type MinutesLabels } from "@/lib/meeting/minutesLabels";

const fieldClass =
  "w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm text-foreground outline-none read-only:cursor-default focus:border-primary focus:bg-background print:hidden";

function Field({
  label,
  value,
  canEdit,
  onChange,
}: {
  label: string;
  value: string | null;
  canEdit: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <input className={fieldClass} value={value ?? ""} readOnly={!canEdit} onChange={(e) => onChange(e.target.value)} placeholder={canEdit ? "—" : ""} />
      <span className="hidden min-w-0 flex-1 whitespace-pre-wrap break-words text-sm print:block">{value || "—"}</span>
    </div>
  );
}

/** Footer block below the minutes table: an optional footnote line, plus
 *  Recorded by / Date / Distributed. Owner-editable; read-only for a
 *  viewer. */
export function MinutesFooter({
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
    <div className="flex flex-col gap-3 border-t border-border pt-4 text-sm">
      {(canEdit || minutes.footnote) && (
        <>
          <textarea
            className="w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs italic text-muted-foreground outline-none read-only:cursor-default focus:border-primary focus:bg-background print:hidden"
            value={minutes.footnote ?? ""}
            readOnly={!canEdit}
            onChange={(e) => onChange("footnote", e.target.value)}
            placeholder={canEdit ? "Footnote (e.g. confidentiality note)" : ""}
            rows={2}
          />
          {minutes.footnote && (
            <p className="hidden whitespace-pre-wrap break-words text-xs italic text-muted-foreground print:block">{minutes.footnote}</p>
          )}
        </>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 print:grid-cols-3">
        <Field label={labels.recordedBy} value={minutes.recordedBy} canEdit={canEdit} onChange={(v) => onChange("recordedBy", v)} />
        <Field label={labels.date} value={minutes.recordedDate} canEdit={canEdit} onChange={(v) => onChange("recordedDate", v)} />
        <Field label={labels.distributed} value={minutes.distributed} canEdit={canEdit} onChange={(v) => onChange("distributed", v)} />
      </div>
    </div>
  );
}
