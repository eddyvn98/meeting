"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { MinutesMatter, MinutesRow } from "@/lib/meeting/overviewSections";
import { formatMatterNumber, formatResponsibleList, parseResponsibleInput } from "@/lib/meeting/minutesFormat";
import { ActionCell } from "./ActionCell";
import { AutoTextarea, cellTextClass, isPlainEnter } from "./AutoTextarea";
import { BulletList } from "./BulletList";
import { RowCommentButton } from "../comments/RowCommentButton";

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function MatterRow({ row, canEdit, ongoingLabel, onChange, onRemove }: { row: MinutesRow; canEdit: boolean; ongoingLabel: string; onChange: (next: MinutesRow) => void; onRemove: () => void }) {
  return (
    <tr className="group/row border-b border-border align-top last:border-b-0">
      <td className="border-r border-border px-1 py-2 text-center">
        <RowCommentButton anchorId={row.id} />
        {canEdit && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Delete row"
            title="Delete row"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600 md:opacity-0 md:transition-opacity md:focus:opacity-100 md:group-hover/row:opacity-100 print:hidden"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </td>
      <td className="border-r border-border px-2 py-2">
        <BulletList
          bullets={row.discussion}
          canEdit={canEdit}
          onChange={(discussion) => onChange({ ...row, discussion })}
          onEmptyBackspace={() => {
            if (row.actions.every((a) => !a.text.trim()) && row.responsible.length === 0) onRemove();
          }}
        />
      </td>
      <td className="border-r border-border px-2 py-2">
        <ActionCell actions={row.actions} canEdit={canEdit} ongoingLabel={ongoingLabel} onChange={(actions) => onChange({ ...row, actions })} />
      </td>
      <td className="px-2 py-2">
        {canEdit ? (
          <AutoTextarea
            className={cellTextClass}
            defaultValue={formatResponsibleList(row.responsible)}
            onBlur={(e) => onChange({ ...row, responsible: parseResponsibleInput(e.target.value) })}
            onKeyDown={(e) => {
              if (isPlainEnter(e)) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            placeholder="Names, comma-separated"
          />
        ) : (
          <span className="whitespace-pre-wrap break-words text-sm">{formatResponsibleList(row.responsible) || "—"}</span>
        )}
      </td>
    </tr>
  );
}

/** One numbered "matter": a full-width bold heading row, followed by its
 *  discussion/action/responsible rows. `matterIndex` is this matter's
 *  0-based position (used only for the S/N number — matters are otherwise
 *  addressed by id). */
export function MatterRows({
  matter,
  matterIndex,
  matterCount,
  canEdit,
  ongoingLabel,
  onChange,
  onRemove,
  onMove,
}: {
  matter: MinutesMatter;
  matterIndex: number;
  matterCount: number;
  canEdit: boolean;
  ongoingLabel: string;
  onChange: (next: MinutesMatter) => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  const updateRow = (rowId: string, next: MinutesRow) => onChange({ ...matter, rows: matter.rows.map((r) => (r.id === rowId ? next : r)) });
  const removeRow = (rowId: string) => onChange({ ...matter, rows: matter.rows.filter((r) => r.id !== rowId) });
  const addRow = () => onChange({ ...matter, rows: [...matter.rows, { id: generateId("row"), discussion: [], actions: [], responsible: [], evidenceSegmentIds: [] }] });

  return (
    <>
      <tr className="group/matter bg-muted/60">
        <td colSpan={4} className="border-b border-t border-border px-2 py-2">
          <div className="flex items-start gap-2">
            <span className="pt-0.5 font-bold">{formatMatterNumber(matterIndex)}.</span>
            <AutoTextarea
              className={`${cellTextClass} flex-1 font-bold`}
              value={matter.title}
              readOnly={!canEdit}
              onChange={(e) => onChange({ ...matter, title: e.target.value })}
              onKeyDown={(e) => {
                if (isPlainEnter(e)) {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (canEdit && e.key === "Backspace" && matter.title === "") {
                  e.preventDefault();
                  onRemove();
                }
              }}
              placeholder="Matter title"
            />
            <RowCommentButton anchorId={matter.id} className="shrink-0" />
            {canEdit && (
              <div className="flex shrink-0 items-center gap-0.5 transition-opacity md:opacity-0 md:focus-within:opacity-100 md:group-hover/matter:opacity-100 print:hidden">
                <button type="button" disabled={matterIndex === 0} onClick={() => onMove("up")} aria-label="Move matter up" className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" disabled={matterIndex === matterCount - 1} onClick={() => onMove("down")} aria-label="Move matter down" className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={onRemove} aria-label="Delete matter" title="Delete matter" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </td>
      </tr>
      {matter.rows.map((row) => (
        <MatterRow key={row.id} row={row} canEdit={canEdit} ongoingLabel={ongoingLabel} onChange={(next) => updateRow(row.id, next)} onRemove={() => removeRow(row.id)} />
      ))}
      {canEdit && (
        <tr>
          <td colSpan={4} className="border-b border-border px-2 py-1 print:hidden">
            <button type="button" onClick={addRow} className="inline-flex items-center gap-1 rounded border border-dashed border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted">
              <Plus className="h-3 w-3" /> Add row
            </button>
          </td>
        </tr>
      )}
    </>
  );
}
