"use client";

/** Small text button shown at the bottom of an editable card while it is
 *  hovered/focused — no icon, so an idle card looks the same as the read-only one. */
export function AddItemButton({ onClick, label = "+ Add" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 self-start text-xs font-medium text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/card:opacity-100"
    >
      {label}
    </button>
  );
}
