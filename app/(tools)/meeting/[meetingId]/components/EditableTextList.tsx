"use client";

import { Fragment, useEffect, useState } from "react";
import type { TextSectionItem } from "@/lib/meeting/overviewSections";
import { InlineText } from "./InlineText";

function newId(): string {
  return `item_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Bulleted `{ id, text }` list edited in place, with the same look as the
 *  read-only list. Click a bullet to edit; Enter adds a new bullet below;
 *  clearing a bullet (or Backspace on an empty one) deletes it. A new bullet
 *  only exists locally until it has text, because the server rejects empty
 *  items. */
export function EditableTextList({
  items,
  onChange,
  listClassName,
  emptyLabel,
  placeholder = "New item…",
  addRequestKey = 0,
}: {
  items: TextSectionItem[];
  onChange: (items: TextSectionItem[]) => void;
  listClassName: string;
  emptyLabel: string;
  placeholder?: string;
  addRequestKey?: number;
}) {
  // Id of the item the not-yet-saved new bullet goes after; "" = at the start.
  const [pendingAfter, setPendingAfter] = useState<string | null>(null);

  useEffect(() => {
    if (addRequestKey > 0) setPendingAfter(items.at(-1)?.id ?? "");
  }, [addRequestKey]);

  const setText = (id: string, text: string) =>
    onChange(text.trim() === "" ? items.filter((i) => i.id !== id) : items.map((i) => (i.id === id ? { ...i, text } : i)));

  const insertAfter = (afterId: string, text: string): string => {
    const item: TextSectionItem = { id: newId(), text: text.trim(), evidenceSegmentIds: [] };
    const index = afterId === "" ? -1 : items.findIndex((i) => i.id === afterId);
    const next = [...items];
    next.splice(index + 1, 0, item);
    onChange(next);
    return item.id;
  };

  const pendingRow = (afterId: string) => (
    <li key="pending">
      <InlineText
        value=""
        autoFocus
        placeholder={placeholder}
        onCommit={(t) => {
          if (t.trim()) insertAfter(afterId, t);
          setPendingAfter(null);
        }}
        onEnter={(t) => setPendingAfter(t.trim() ? insertAfter(afterId, t) : null)}
        onBackspaceEmpty={() => setPendingAfter(null)}
      />
    </li>
  );

  if (items.length === 0) {
    return pendingAfter !== null ? (
      <ul className={listClassName}>{pendingRow("")}</ul>
    ) : (
      <button type="button" onClick={() => setPendingAfter("")} className="py-4 text-left text-sm text-muted-foreground hover:text-foreground">
        {emptyLabel}
      </button>
    );
  }

  return (
    <ul className={listClassName}>
      {items.map((item) => (
        <Fragment key={item.id}>
          <li>
            <InlineText
              value={item.text}
              onCommit={(t) => setText(item.id, t)}
              onEnter={(t) => {
                if (t !== item.text) setText(item.id, t);
                if (t.trim()) setPendingAfter(item.id);
              }}
              onBackspaceEmpty={() => setText(item.id, "")}
            />
          </li>
          {pendingAfter === item.id && pendingRow(item.id)}
        </Fragment>
      ))}
    </ul>
  );
}
