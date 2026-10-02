"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { DEFAULT_SECTION_TITLES, OVERVIEW_SECTION_KINDS, isOverviewVisibleKind, type OverviewSectionKind } from "@/lib/meeting/overviewSections";

/** "Add section" menu on the Overview tab (owner-only) — lists every kind in
 *  the fixed library (overviewSections.ts) with its default title, so
 *  picking one is self-explanatory without a separate naming step. */
export function MeetingAddSectionMenu({ onAdd, disabled }: { onAdd: (kind: OverviewSectionKind) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
      >
        <Plus className="h-3.5 w-3.5" /> Add section
      </button>
      {open && (
        <div className="absolute left-0 z-10 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-border bg-card p-1 shadow-lg">
          {OVERVIEW_SECTION_KINDS.filter(isOverviewVisibleKind).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => { onAdd(kind); setOpen(false); }}
              className="block w-full rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
            >
              {DEFAULT_SECTION_TITLES[kind]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
