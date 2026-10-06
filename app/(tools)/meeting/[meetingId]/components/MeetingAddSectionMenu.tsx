"use client";

import { Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DEFAULT_SECTION_TITLES,
  OVERVIEW_SECTION_KINDS,
  isOverviewVisibleKind,
  type OverviewSectionKind,
} from "@/lib/meeting/overviewSections";

/** "Add section" menu on the Overview tab (owner/editor only) — lists every
 *  visible kind in the fixed library. Uses the shared Radix dropdown so the
 *  menu is rendered in a portal and can flip above the trigger when there
 *  isn't enough room below, instead of being clipped by the Overview scroll
 *  container and forcing the user to scroll down to see it. */
export function MeetingAddSectionMenu({
  onAdd,
  disabled,
}: {
  onAdd: (kind: OverviewSectionKind) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-brand-orange hover:text-brand-orange disabled:opacity-60"
        >
          <Plus className="h-3.5 w-3.5" /> Add section
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className="w-56 max-h-72 overflow-y-auto"
      >
        {OVERVIEW_SECTION_KINDS.filter(isOverviewVisibleKind).map((kind) => (
          <DropdownMenuItem key={kind} onSelect={() => onAdd(kind)}>
            {DEFAULT_SECTION_TITLES[kind]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
