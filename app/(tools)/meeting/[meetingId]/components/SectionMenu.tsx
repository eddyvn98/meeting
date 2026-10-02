"use client";

import { ChevronDown, ChevronUp, Loader2, MoreHorizontal, Sparkles, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** "..." menu (dimmed until hovered) on a section card: move up/down and delete. Delete is
 *  undoable from the toast, so it has no confirmation step. "Generate with AI"
 *  is offered for the kinds the AI can fill and only adds items. */
export function SectionMenu({
  canMoveUp,
  canMoveDown,
  disabled,
  onMove,
  onDelete,
  onGenerate,
  generating,
}: {
  canMoveUp: boolean;
  canMoveDown: boolean;
  disabled: boolean;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
  /** Omitted for kinds the AI cannot generate. */
  onGenerate?: () => void;
  generating?: boolean;
}) {
  return (
    <div className="ml-auto flex items-center gap-1.5">
      {generating && (
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-muted-foreground" role="status">
          <Loader2 className="h-3 w-3 animate-spin" />
          AI generating…
        </span>
      )}
      <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Section actions"
          title="Section actions"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-60 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:opacity-100 group-hover/card:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {onGenerate && (
          <>
            <DropdownMenuItem disabled={generating} onSelect={onGenerate}>
              {generating ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
              {generating ? "Generating…" : "Generate with AI"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem disabled={!canMoveUp || disabled} onSelect={() => onMove("up")}>
          <ChevronUp className="mr-2 h-3.5 w-3.5" /> Move up
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canMoveDown || disabled} onSelect={() => onMove("down")}>
          <ChevronDown className="mr-2 h-3.5 w-3.5" /> Move down
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} className="text-red-600 focus:text-red-600">
          <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete section
        </DropdownMenuItem>
      </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
