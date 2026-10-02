"use client";

import type { ReactNode } from "react";
import { InlineText } from "./InlineText";
import { BilingualText } from "./BilingualText";

/** Inline-editing hooks a section card receives when the viewer can edit it.
 *  Omitted for read-only viewers, which get the plain display card. */
export interface SectionEdit<T> {
  onTitleChange: (title: string) => void;
  onItemsChange: (items: T[]) => void;
  /** The hover-only "..." menu (move / delete) — see SectionMenu.tsx. */
  menu: ReactNode;
}

/** Shared card header: icon, title (click-to-edit when `edit` is given), and
 *  the section menu. The card root must carry the `group/card` class. */
export function SectionCardHeader({ icon, title, edit }: { icon: ReactNode; title: string; edit?: { onTitleChange: (title: string) => void; menu: ReactNode } }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {icon}
      {edit ? (
        <div className="min-w-0 flex-1 text-sm font-semibold text-card-foreground">
          <InlineText value={title} ariaLabel="Section title" onCommit={(t) => t.trim() && edit.onTitleChange(t.trim())} />
        </div>
      ) : (
        <h3 className="text-sm font-semibold text-card-foreground"><BilingualText text={title} /></h3>
      )}
      {edit?.menu}
    </div>
  );
}
