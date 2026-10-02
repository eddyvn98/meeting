"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { MeetingMinutes, OverviewSection } from "@/lib/meeting/types";
import type { AttendanceSectionItem, MinutesMatter } from "@/lib/meeting/overviewSections";
import { autosaveReducer, hasUnsavedEdit, INITIAL_AUTOSAVE_STATE, type AutosaveStatus } from "@/lib/meeting/minutesAutosave";
import type { MinutesHeaderFields } from "@/lib/meeting/minutesTypes";
import { browserTimeZoneQuery } from "@/lib/meeting/minutesDefaults";
import { useUndoManager } from "../useUndoManager";

const AUTOSAVE_DEBOUNCE_MS = 800;

async function requestJson(url: string, method: string, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data && typeof data === "object" && "error" in data && String((data as { error: unknown }).error)) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

/** Finds an existing section by kind, or `null` if the meeting has none of
 *  that kind yet (e.g. no `attendance` section until the first edit). */
function findSection(sections: OverviewSection[], kind: string): OverviewSection | undefined {
  return sections.find((s) => s.kind === kind);
}

/** Total row count across every matter — used alongside the top-level
 *  matters array length to detect a "delete" (a matter removed OR a row
 *  removed from inside one) for the undo toast's label. */
function totalRows(matters: MinutesMatter[]): number {
  return matters.reduce((sum, m) => sum + (Array.isArray(m.rows) ? m.rows.length : 0), 0);
}

interface EditorProps {
  meetingId: string;
  accessRole: "owner" | "editor" | "viewer";
  sections: OverviewSection[];
  setSections: (updater: (prev: OverviewSection[]) => OverviewSection[]) => void;
  setMinutes: (updater: (prev: MeetingMinutes | null) => MeetingMinutes | null) => void;
}

/**
 * Central editing controller for the Stage B minutes page — header/footer
 * fields (PATCH .../minutes), the `attendance` section, and the
 * `minutes_table` section (both PATCH .../sections/[id] like the Overview
 * tab's own editor — see useOverviewSectionsEditor.ts, whose
 * optimistic-update + rollback + toast pattern this mirrors).
 *
 * `canEdit` is the ONE place that decides whether the current caller may
 * edit — Stage C's shared "editor" role only changes this one line, not
 * every call site.
 */
export function useMinutesEditor({ meetingId, accessRole, sections, setSections, setMinutes }: EditorProps) {
  // Owner or an active "editor" share grant can edit; a "viewer" grant is
  // always read-only. See app/api/meeting/_access.ts's MeetingAccessRole.
  const canEdit = accessRole === "owner" || accessRole === "editor";
  const undoManager = useUndoManager();

  const [autosave, setAutosave] = useState(INITIAL_AUTOSAVE_STATE);
  const autosaveRef = useRef(autosave);
  autosaveRef.current = autosave;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHeaderRef = useRef<Partial<MinutesHeaderFields>>({});
  const pendingRoleUpdatesRef = useRef<Map<string, { role?: string; organization?: string }>>(new Map());

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const flushHeader = useCallback(async () => {
    const fields = pendingHeaderRef.current;
    const roleUpdates = Array.from(pendingRoleUpdatesRef.current, ([name, details]) => ({ name, ...details }));
    pendingHeaderRef.current = {};
    pendingRoleUpdatesRef.current = new Map();
    if (Object.keys(fields).length === 0 && roleUpdates.length === 0) return;

    setAutosave((s) => autosaveReducer(s, { type: "saveStart" }));
    try {
      const saved = (await requestJson(`/api/meeting/${meetingId}/minutes?${browserTimeZoneQuery()}`, "PATCH", { ...fields, roleUpdates })) as MeetingMinutes;
      setMinutes(() => saved);
      setAutosave((s) => autosaveReducer(s, { type: "saveSuccess" }));
    } catch (err) {
      setAutosave((s) => autosaveReducer(s, { type: "saveError" }));
      toast.error(err instanceof Error ? err.message : "Could not save minutes");
      return;
    }
    // Another edit landed while this save was in flight — go again.
    if (hasUnsavedEdit(autosaveRef.current)) scheduleFlush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, setMinutes]);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flushHeader();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [flushHeader]);

  /** Debounced header/footer field edit — optimistic in `minutes`, queued
   *  for the next autosave flush. */
  const updateHeaderField = useCallback(
    (field: keyof MinutesHeaderFields, value: string) => {
      if (!canEdit) return;
      pendingHeaderRef.current[field] = value || null;
      setMinutes((prev) => (prev ? { ...prev, [field]: value || null } : prev));
      setAutosave((s) => autosaveReducer(s, { type: "edit" }));
      scheduleFlush();
    },
    [canEdit, scheduleFlush, setMinutes],
  );

  /** Queues a person's role and/or organization to be remembered
   *  (MeetingPersonRole) on the next autosave flush, alongside whatever
   *  header fields are also pending. */
  const queueRoleUpdate = useCallback(
    (name: string, details: { role?: string; organization?: string }) => {
      const role = details.role?.trim();
      const organization = details.organization?.trim();
      if (!canEdit || !name.trim() || (!role && !organization)) return;
      const previous = pendingRoleUpdatesRef.current.get(name.trim());
      pendingRoleUpdatesRef.current.set(name.trim(), { ...previous, ...(role ? { role } : {}), ...(organization ? { organization } : {}) });
      setAutosave((s) => autosaveReducer(s, { type: "edit" }));
      scheduleFlush();
    },
    [canEdit, scheduleFlush],
  );

  const status: AutosaveStatus = autosave.status;

  /** Generic PATCH .../sections/[id] with optimistic update + rollback,
   *  used by both attendance and minutes_table item saves below. Returns
   *  whether the request succeeded, so callers only record an undo entry
   *  for a mutation that actually landed. */
  const saveSectionItems = useCallback(
    async (sectionId: string, items: unknown[], previousItems: unknown[]): Promise<boolean> => {
      setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, items, source: "user" } : s)));
      try {
        await requestJson(`/api/meeting/${meetingId}/sections/${sectionId}`, "PATCH", { items });
        return true;
      } catch (err) {
        setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, items: previousItems, source: s.source } : s)));
        toast.error(err instanceof Error ? err.message : "Could not save changes");
        return false;
      }
    },
    [meetingId, setSections],
  );

  /** Restores `sectionId`'s items back to `previousItems`, both locally and
   *  on the server — the undo closure shared by saveAttendance/saveMatters. */
  const restoreSectionItems = useCallback(
    (sectionId: string, previousItems: unknown[]) => {
      return async () => {
        setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, items: previousItems } : s)));
        await requestJson(`/api/meeting/${meetingId}/sections/${sectionId}`, "PATCH", { items: previousItems });
      };
    },
    [meetingId, setSections],
  );

  /** Creates the `attendance` section on first edit (there is none until
   *  then — see GET .../minutes' attendanceSuggestions doc comment), then
   *  saves `items`. */
  const saveAttendance = useCallback(
    async (items: AttendanceSectionItem[]) => {
      if (!canEdit) return;
      const existing = findSection(sections, "attendance");
      if (existing) {
        const previousItems = existing.items;
        const ok = await saveSectionItems(existing.id, items, previousItems);
        if (ok) {
          const label = items.length < previousItems.length ? "Attendee deleted" : "Saved";
          undoManager.record(label, restoreSectionItems(existing.id, previousItems));
        }
        return;
      }
      try {
        const created = (await requestJson(`/api/meeting/${meetingId}/sections`, "POST", { kind: "attendance", items })) as OverviewSection;
        setSections((prev) => [...prev, created]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not save attendance");
      }
    },
    [canEdit, meetingId, restoreSectionItems, saveSectionItems, sections, setSections, undoManager],
  );

  const saveMatters = useCallback(
    async (matters: MinutesMatter[]) => {
      if (!canEdit) return;
      const existing = findSection(sections, "minutes_table");
      if (existing) {
        const previousMatters = existing.items as MinutesMatter[];
        const ok = await saveSectionItems(existing.id, matters, previousMatters);
        if (ok) {
          const deleted = matters.length < previousMatters.length || totalRows(matters) < totalRows(previousMatters);
          undoManager.record(deleted ? "Item deleted" : "Saved", restoreSectionItems(existing.id, previousMatters));
        }
        return;
      }
      try {
        const created = (await requestJson(`/api/meeting/${meetingId}/sections`, "POST", { kind: "minutes_table", items: matters })) as OverviewSection;
        setSections((prev) => [...prev, created]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not save the minutes table");
      }
    },
    [canEdit, meetingId, restoreSectionItems, saveSectionItems, sections, setSections, undoManager],
  );

  const [generating, setGenerating] = useState(false);
  const generate = useCallback(
    async (confirmReplace = false, language = "auto"): Promise<{ ok: true } | { ok: false; needsConfirm: true } | { ok: false; needsConfirm: false }> => {
      setGenerating(true);
      try {
        const res = await fetch(`/api/meeting/${meetingId}/minutes/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmReplace, language }),
        });
        if (res.status === 409) return { ok: false, needsConfirm: true };
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          toast.error((data && typeof data === "object" && "error" in data && String(data.error)) || "Could not generate minutes");
          return { ok: false, needsConfirm: false };
        }
        const section = data as OverviewSection;
        setSections((prev) => (prev.some((s) => s.id === section.id) ? prev.map((s) => (s.id === section.id ? section : s)) : [...prev, section]));
        return { ok: true };
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not generate minutes");
        return { ok: false, needsConfirm: false };
      } finally {
        setGenerating(false);
      }
    },
    [meetingId, setSections],
  );

  return { canEdit, autosaveStatus: status, updateHeaderField, queueRoleUpdate, saveAttendance, saveMatters, generate, generating };
}
