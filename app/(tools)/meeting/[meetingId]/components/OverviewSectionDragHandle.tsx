"use client";

import { GripVertical } from "lucide-react";
import type { DragEvent } from "react";

export function OverviewSectionDragHandle({
	label,
	disabled,
	onDragStart,
	onDragEnd,
}: {
	label: string;
	disabled: boolean;
	onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
	onDragEnd: () => void;
}) {
	return (
		<button
			type="button"
			draggable={!disabled}
			aria-label={`Drag to reorder ${label}`}
			title="Drag to reorder"
			className="flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground hover:opacity-100 active:cursor-grabbing"
			disabled={disabled}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
		>
			<GripVertical className="h-4 w-4" aria-hidden="true" />
		</button>
	);
}
