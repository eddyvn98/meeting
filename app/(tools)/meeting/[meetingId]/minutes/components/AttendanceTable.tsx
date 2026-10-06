"use client";

import { useEffect, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import type { AttendanceSectionItem } from "@/lib/meeting/overviewSections";
import type { AttendanceSuggestion } from "@/lib/meeting/types";
import { resolveMinutesLabels, type MinutesLabels } from "@/lib/meeting/minutesLabels";

const cellInput = "w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none read-only:cursor-default focus:border-brand-orange focus:bg-background print:hidden";

function generateId(): string {
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const normalize = (name: string) => name.trim().toLowerCase();

type StatusValue = NonNullable<AttendanceSectionItem["status"]>;

function StatusButton({ value, active, disabled, onClick }: { value: StatusValue; active: boolean; disabled: boolean; onClick: () => void }) {
  const present = value === "present";
  const label = present ? "Present" : "Regrets";
  const Icon = present ? Check : X;
  const activeClass = present ? "border-emerald-600 bg-emerald-600 text-white" : "border-red-600 bg-red-600 text-white";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors disabled:cursor-default ${
        active ? activeClass : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/** Attendance table — Name | Role | Organization | Present / Regrets. Owner
 *  can add/remove rows, edit fields, and mark each person present (✔) or
 *  regrets (✗); a viewer sees it read-only. Picking a name someone has been
 *  saved under before fills in their role and organization. Unlisted
 *  `attendanceSuggestions` (named speakers not yet added as a row) are
 *  offered below as one-click "add" chips. */
export function AttendanceTable({
  items,
  suggestions,
  knownPeople,
  canEdit,
  onChange,
  onQueueRole,
  labels = resolveMinutesLabels(),
}: {
  items: AttendanceSectionItem[];
  suggestions: AttendanceSuggestion[];
  knownPeople: AttendanceSuggestion[];
  canEdit: boolean;
  onChange: (items: AttendanceSectionItem[]) => void;
  onQueueRole: (name: string, details: { role?: string; organization?: string }) => void;
  labels?: MinutesLabels;
}) {
  const [draft, setDraft] = useState(items);
  useEffect(() => setDraft(items), [items]);

  // People the owner saved before, plus this meeting's named speakers.
  const known = new Map<string, AttendanceSuggestion>();
  for (const person of [...suggestions, ...knownPeople]) {
    const key = normalize(person.name);
    const existing = known.get(key);
    known.set(key, existing ? { ...existing, role: existing.role ?? person.role, organization: existing.organization ?? person.organization } : person);
  }
  const knownList = Array.from(known.values());

  const commit = (next: AttendanceSectionItem[]) => {
    setDraft(next);
    onChange(next);
  };

  const addRow = (prefill?: AttendanceSuggestion) => {
    commit([
      ...draft,
      { id: generateId(), name: prefill?.name ?? "New attendee", role: prefill?.role ?? null, organization: prefill?.organization ?? null, status: null },
    ]);
  };

  const removeRow = (id: string) => commit(draft.filter((r) => r.id !== id));

  const updateRow = (id: string, patch: Partial<AttendanceSectionItem>) => {
    setDraft(draft.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  /** Typing or picking a saved person's name fills their role and organization, unless the row already has them. */
  const changeName = (row: AttendanceSectionItem, name: string) => {
    const person = known.get(normalize(name));
    updateRow(row.id, {
      name,
      ...(person && !row.role && !row.organization ? { role: person.role, organization: person.organization } : {}),
    });
  };

  const rememberPerson = (row: AttendanceSectionItem) => {
    if (row.role || row.organization) onQueueRole(row.name, { role: row.role ?? undefined, organization: row.organization ?? undefined });
  };

  const addedNames = new Set(draft.map((r) => normalize(r.name)));
  const unadded = suggestions.filter((s) => !addedNames.has(normalize(s.name)));

  return (
    <div className="flex flex-col gap-2">
      <datalist id="attendance-known-names">
        {knownList.map((person) => (
          <option key={normalize(person.name)} value={person.name} label={[person.role, person.organization].filter(Boolean).join(" · ") || undefined} />
        ))}
      </datalist>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="minutes-attendance-table w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="bg-muted text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="border-b border-border px-2 py-2">{labels.name}</th>
              <th className="border-b border-border px-2 py-2">{labels.role}</th>
              <th className="border-b border-border px-2 py-2">{labels.organization}</th>
              <th className="border-b border-border px-2 py-2 text-center">{labels.presentRegrets}</th>
              {canEdit && <th className="border-b border-border px-2 py-2 print:hidden" />}
            </tr>
          </thead>
          <tbody>
            {draft.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-b-0">
                <td className="px-2 py-1.5">
                  <input
                    className={cellInput}
                    list={canEdit ? "attendance-known-names" : undefined}
                    value={row.name}
                    readOnly={!canEdit}
                    onChange={(e) => changeName(row, e.target.value)}
                    onBlur={() => commit(draft)}
                  />
                  <span className="hidden whitespace-pre-wrap break-words text-sm print:inline">{row.name || "—"}</span>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    className={cellInput}
                    value={row.role ?? ""}
                    readOnly={!canEdit}
                    onChange={(e) => updateRow(row.id, { role: e.target.value || null })}
                    onBlur={() => {
                      commit(draft);
                      rememberPerson(row);
                    }}
                    placeholder={canEdit ? "e.g. Chair" : ""}
                  />
                  <span className="hidden whitespace-pre-wrap break-words text-sm print:inline">{row.role || "—"}</span>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    className={cellInput}
                    value={row.organization ?? ""}
                    readOnly={!canEdit}
                    onChange={(e) => updateRow(row.id, { organization: e.target.value || null })}
                    onBlur={() => {
                      commit(draft);
                      rememberPerson(row);
                    }}
                    placeholder={canEdit ? "e.g. Organization" : ""}
                  />
                  <span className="hidden whitespace-pre-wrap break-words text-sm print:inline">{row.organization || "—"}</span>
                </td>
                <td className="px-2 py-1.5 text-center">
                  {canEdit ? (
                    <>
                      <div className="inline-flex items-center gap-1.5 print:hidden">
                        {(["present", "regrets"] as const).map((value) => (
                          <StatusButton
                            key={value}
                            value={value}
                            active={row.status === value}
                            disabled={false}
                            onClick={() => commit(draft.map((r) => (r.id === row.id ? { ...r, status: r.status === value ? null : value } : r)))}
                          />
                        ))}
                      </div>
                      <span className="hidden print:inline">{row.status === "present" ? "✓" : row.status === "regrets" ? "✕" : "—"}</span>
                    </>
                  ) : row.status === "present" ? (
                    <Check className="mx-auto h-4 w-4 text-emerald-600" aria-label="Present" />
                  ) : row.status === "regrets" ? (
                    <X className="mx-auto h-4 w-4 text-red-600" aria-label="Regrets" />
                  ) : (
                    <span>—</span>
                  )}
                </td>
                {canEdit && (
                  <td className="px-2 py-1.5 text-right print:hidden">
                    <button type="button" onClick={() => removeRow(row.id)} aria-label="Remove attendee" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {draft.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 5 : 4} className="px-2 py-3 text-center text-sm text-muted-foreground">
                  No attendees added yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <button type="button" onClick={() => addRow()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted">
            <Plus className="h-3.5 w-3.5" /> Add attendee
          </button>
          {unadded.map((s) => (
            <button
              key={s.name}
              type="button"
              onClick={() => addRow(s)}
              className="rounded-full border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              + {s.name}
              {s.role ? ` (${s.role})` : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
