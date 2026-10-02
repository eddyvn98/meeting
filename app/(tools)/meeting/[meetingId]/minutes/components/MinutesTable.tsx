"use client";

import { Plus } from "lucide-react";
import type { MinutesMatter } from "@/lib/meeting/overviewSections";
import { moveItem, removeItem } from "@/lib/meeting/minutesReorder";
import { MatterRows } from "./MatterRows";
import { resolveMinutesLabels, type MinutesLabels } from "@/lib/meeting/minutesLabels";

function generateId(): string {
  return `matter_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** The MOM minutes table — S/N | Matter Discussed | Action to be taken
 *  (Duration, Deadline) | Responsible — as numbered matters, each with its
 *  own discussion/action/responsible rows (MatterRows.tsx). Horizontally
 *  scrolls inside its own container on narrow screens so the page itself
 *  never gains horizontal scroll. */
export function MinutesTable({ matters, canEdit, onChange, labels = resolveMinutesLabels() }: { matters: MinutesMatter[]; canEdit: boolean; onChange: (next: MinutesMatter[]) => void; labels?: MinutesLabels }) {
  const updateMatter = (id: string, next: MinutesMatter) => onChange(matters.map((m) => (m.id === id ? next : m)));
  const removeMatter = (index: number) => onChange(removeItem(matters, index));
  const moveMatter = (index: number, direction: "up" | "down") => onChange(moveItem(matters, index, direction));
  const addMatter = () => onChange([...matters, { id: generateId(), title: "New matter", rows: [] }]);

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="minutes-main-table w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-muted text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="w-10 border-b border-r border-border px-2 py-2">{labels.serialNumber}</th>
              <th className="border-b border-r border-border px-2 py-2">{labels.matterDiscussed}</th>
              <th className="w-64 border-b border-r border-border px-2 py-2">{labels.actionToBeTaken}</th>
              <th className="w-40 border-b border-border px-2 py-2">{labels.responsible}</th>
            </tr>
          </thead>
          <tbody>
            {matters.map((matter, index) => (
              <MatterRows
                key={matter.id}
                matter={matter}
                matterIndex={index}
                matterCount={matters.length}
                canEdit={canEdit}
                ongoingLabel={labels.ongoing}
                onChange={(next) => updateMatter(matter.id, next)}
                onRemove={() => removeMatter(index)}
                onMove={(direction) => moveMatter(index, direction)}
              />
            ))}
            {matters.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-4 text-center text-sm text-muted-foreground">
                  No matters yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <button type="button" onClick={addMatter} className="inline-flex items-center gap-1 self-start rounded-md border border-dashed border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted print:hidden">
          <Plus className="h-3.5 w-3.5" /> Add matter
        </button>
      )}
    </div>
  );
}
