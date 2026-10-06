"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { MeetingSummary, OverviewSection } from "@/lib/meeting/types";
import { isOverviewVisibleKind, type OverviewSectionKind } from "@/lib/meeting/overviewSections";
import { getStoredOutputLanguage } from "@/lib/meeting/outputLanguage";
import { useUndoManager } from "./useUndoManager";

type SetSummary = (updater: (prev: MeetingSummary) => MeetingSummary) => void;

async function requestJson(url: string, method: string, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && typeof data === "object" && "error" in data && String((data as { error: unknown }).error)) || `Request failed (${res.status})`);
  return data;
}

/**
 * Owner-only editing for the Overview tab's dynamic sections (Step 3 of the
 * dynamic overview feature) — every mutation applies to `summary` first
 * (optimistic), then confirms against the sections/summary API routes
 * (app/api/meeting/[meetingId]/sections/**), rolling the local state back to
 * its pre-mutation snapshot and showing a toast if the request fails. Called
 * from MeetingOverviewTab.tsx; `setSummary` is threaded down from page.tsx so
 * an edit here is visible immediately to every other reader of
 * `detail.summary` (translation overlay, download menu, mindmap button).
 *
 * Every successful content-changing or destructive mutation also records an
 * undo entry (see useUndoManager.ts) — a sonner toast with an "Undo" action
 * that re-sends the pre-mutation value, plus Ctrl/Cmd+Z support.
 */
export function useOverviewSectionsEditor(meetingId: string, summary: MeetingSummary | null, setSummary: SetSummary) {
  const [savingSectionId, setSavingSectionId] = useState<string | null>(null);
  const [reorderingSections, setReorderingSections] = useState(false);
  const [savingOverview, setSavingOverview] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [generatingTimeline, setGeneratingTimeline] = useState(false);
  const [generatingSectionId, setGeneratingSectionId] = useState<string | null>(null);
  const undoManager = useUndoManager();

  /** Optimistic-update + rollback; returns whether the request succeeded so
   *  callers only record an undo entry for a mutation that actually landed. */
  async function withRollback(mutate: (prev: MeetingSummary) => MeetingSummary, request: () => Promise<void>, errorMessage: string): Promise<boolean> {
    if (!summary) return false;
    const previous = summary;
    setSummary(mutate);
    try {
      await request();
      return true;
    } catch (err) {
      setSummary(() => previous);
      toast.error(err instanceof Error ? err.message : errorMessage);
      return false;
    }
  }

  const updateOverview = async (overview: string) => {
    if (!summary || overview === summary.overview) return;
    const previousOverview = summary.overview;
    setSavingOverview(true);
    const ok = await withRollback(
      (prev) => ({ ...prev, overview }),
      async () => {
        await requestJson(`/api/meeting/${meetingId}/summary`, "PATCH", { overview });
      },
      "Could not save the overview text",
    );
    setSavingOverview(false);
    if (ok) {
      undoManager.record("Saved", async () => {
        setSummary((prev) => ({ ...prev, overview: previousOverview }));
        await requestJson(`/api/meeting/${meetingId}/summary`, "PATCH", { overview: previousOverview });
      });
    }
  };

  const regenerateSummary = async () => {
    if (!summary || generatingSummary) return;
    setGeneratingSummary(true);
    try {
      const data = (await requestJson(`/api/meeting/${meetingId}/summary/generate`, "POST", {
        target: "summary",
        language: getStoredOutputLanguage(),
      })) as { summary: MeetingSummary };
      setSummary((prev) => ({ ...prev, overview: data.summary.overview, updatedAt: data.summary.updatedAt }));
      toast.success("Summary regenerated with AI.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not regenerate the summary");
    } finally {
      setGeneratingSummary(false);
    }
  };

  const regenerateTimeline = async () => {
    if (!summary || generatingTimeline) return;
    setGeneratingTimeline(true);
    try {
      const data = (await requestJson(`/api/meeting/${meetingId}/summary/generate`, "POST", {
        target: "timeline",
        language: getStoredOutputLanguage(),
      })) as { summary: MeetingSummary; generatedCount: number };
      setSummary((prev) => ({ ...prev, topics: data.summary.topics, updatedAt: data.summary.updatedAt }));
      if (data.generatedCount === 0) toast.info("The AI found no timeline entries in this transcript.");
      else toast.success("Timeline regenerated with AI.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not regenerate the timeline");
    } finally {
      setGeneratingTimeline(false);
    }
  };

  const addSection = async (kind: OverviewSectionKind) => {
    if (!summary) return;
    try {
      const created = (await requestJson(`/api/meeting/${meetingId}/sections`, "POST", { kind })) as OverviewSection;
      setSummary((prev) => ({ ...prev, sections: [...prev.sections, created] }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add section");
    }
  };

  const renameSection = async (sectionId: string, title: string) => {
    const section = summary?.sections.find((s) => s.id === sectionId);
    if (!section || !title.trim() || title === section.title) return;
    const previousTitle = section.title;
    setSavingSectionId(sectionId);
    const ok = await withRollback(
      (prev) => ({ ...prev, sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, title, source: "user" } : s)) }),
      async () => {
        await requestJson(`/api/meeting/${meetingId}/sections/${sectionId}`, "PATCH", { title });
      },
      "Could not rename the section",
    );
    setSavingSectionId(null);
    if (ok) {
      undoManager.record("Saved", async () => {
        setSummary((prev) => ({ ...prev, sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, title: previousTitle } : s)) }));
        await requestJson(`/api/meeting/${meetingId}/sections/${sectionId}`, "PATCH", { title: previousTitle });
      });
    }
  };

  const deleteSection = async (sectionId: string) => {
    const section = summary?.sections.find((s) => s.id === sectionId);
    if (!section) return;
    // Snapshot the full display order before removal so undo can restore
    // this section back to its original slot, not just append it.
    const orderedIds = summary ? [...summary.sections].sort((a, b) => a.order - b.order).map((s) => s.id) : [];
    const ok = await withRollback(
      (prev) => ({ ...prev, sections: prev.sections.filter((s) => s.id !== sectionId) }),
      async () => {
        await requestJson(`/api/meeting/${meetingId}/sections/${sectionId}`, "DELETE");
      },
      "Could not delete the section",
    );
    if (ok) {
      undoManager.record("Section deleted", async () => {
        const created = (await requestJson(`/api/meeting/${meetingId}/sections`, "POST", {
          kind: section.kind,
          title: section.title,
          items: section.items,
        })) as OverviewSection;
        setSummary((prev) => ({ ...prev, sections: [...prev.sections, created] }));
        const restoredIds = orderedIds.map((id) => (id === sectionId ? created.id : id));
        await requestJson(`/api/meeting/${meetingId}/sections/reorder`, "PATCH", { ids: restoredIds });
        setSummary((prev) => ({ ...prev, sections: prev.sections.map((s) => ({ ...s, order: restoredIds.indexOf(s.id) })) }));
      });
    }
  };

  /** Swaps `sectionId` with its up/down neighbor in display order and
   *  persists the whole new order in one PATCH .../reorder call. */
  const moveSection = async (sectionId: string, direction: "up" | "down") => {
    if (!summary) return;
    const ordered = [...summary.sections].sort((a, b) => a.order - b.order);
    // Move among Overview-visible sections only; Minutes-only sections keep
    // their slots so the reorder request still covers every section id.
    const visible = ordered.filter((s) => isOverviewVisibleKind(s.kind));
    const visibleIndex = visible.findIndex((s) => s.id === sectionId);
    const neighbor = visible[direction === "up" ? visibleIndex - 1 : visibleIndex + 1];
    if (visibleIndex === -1 || !neighbor) return;
    const index = ordered.findIndex((s) => s.id === sectionId);
    const swapWith = ordered.findIndex((s) => s.id === neighbor.id);
    const next = [...ordered];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    const ids = next.map((s) => s.id);
    await withRollback(
      (prev) => ({ ...prev, sections: next.map((s, i) => ({ ...s, order: i })) }),
      async () => {
        await requestJson(`/api/meeting/${meetingId}/sections/reorder`, "PATCH", { ids });
      },
      "Could not reorder sections",
    );
  };

  const reorderSections = async (visibleIds: string[]) => {
    if (!summary || reorderingSections) return;
    const ordered = [...summary.sections].sort((a, b) => a.order - b.order);
    const visible = ordered.filter((section) => isOverviewVisibleKind(section.kind));
    const visibleIdSet = new Set(visible.map((section) => section.id));
    if (visibleIds.length !== visible.length || visibleIds.some((id) => !visibleIdSet.has(id))) return;
    if (visible.every((section, index) => section.id === visibleIds[index])) return;

    const visibleById = new Map(visible.map((section) => [section.id, section] as const));
    let visibleIndex = 0;
    const next = ordered.map((section) =>
      isOverviewVisibleKind(section.kind) ? visibleById.get(visibleIds[visibleIndex++])! : section,
    );
    const ids = next.map((section) => section.id);
    setReorderingSections(true);
    try {
      await withRollback(
        (prev) => ({ ...prev, sections: next.map((section, index) => ({ ...section, order: index })) }),
        async () => {
          await requestJson(`/api/meeting/${meetingId}/sections/reorder`, "PATCH", { ids });
        },
        "Could not reorder sections",
      );
    } finally {
      setReorderingSections(false);
    }
  };

  /** "Generate with AI" for one section: the server ADDS new items next to the
   *  existing ones (never overwrites), so there is nothing to confirm. */
  const generateSection = async (sectionId: string) => {
    const section = summary?.sections.find((s) => s.id === sectionId);
    if (!section || generatingSectionId) return;
    const previousItems = section.items;
    setGeneratingSectionId(sectionId);
    try {
      const data = (await requestJson(`/api/meeting/${meetingId}/sections/${sectionId}/generate`, "POST", { language: getStoredOutputLanguage() })) as { section: OverviewSection; added: number };
      if (data.added === 0) {
        toast.info("The AI found nothing new to add to this section.");
        return;
      }
      setSummary((prev) => ({ ...prev, sections: prev.sections.map((s) => (s.id === sectionId ? data.section : s)) }));
      undoManager.record(`AI added ${data.added} item${data.added === 1 ? "" : "s"}`, async () => {
        setSummary((prev) => ({ ...prev, sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, items: previousItems } : s)) }));
        await requestJson(`/api/meeting/${meetingId}/sections/${sectionId}`, "PATCH", { items: previousItems });
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate items");
    } finally {
      setGeneratingSectionId(null);
    }
  };

  const saveItems = async (sectionId: string, items: unknown[]) => {
    const section = summary?.sections.find((s) => s.id === sectionId);
    const previousItems = section?.items ?? [];
    setSavingSectionId(sectionId);
    const ok = await withRollback(
      (prev) => ({ ...prev, sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, items, source: "user" } : s)) }),
      async () => {
        await requestJson(`/api/meeting/${meetingId}/sections/${sectionId}`, "PATCH", { items });
      },
      "Could not save changes",
    );
    setSavingSectionId(null);
    if (ok) {
      const label = items.length < previousItems.length ? "Item deleted" : "Saved";
      undoManager.record(label, async () => {
        setSummary((prev) => ({ ...prev, sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, items: previousItems } : s)) }));
        await requestJson(`/api/meeting/${meetingId}/sections/${sectionId}`, "PATCH", { items: previousItems });
      });
    }
  };

  return {
    savingSectionId,
    reorderingSections,
    savingOverview,
    generatingSummary,
    generatingTimeline,
    generatingSectionId,
    regenerateSummary,
    regenerateTimeline,
    generateSection,
    updateOverview,
    addSection,
    renameSection,
    deleteSection,
    moveSection,
    reorderSections,
    saveItems,
  };
}
