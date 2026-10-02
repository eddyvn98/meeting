"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Shared "View all …" modal chrome for the Overview tab's 3-up Action
 * Items / Decisions / Blockers cards (MeetingActionItemsCard.tsx,
 * MeetingDecisionsCard.tsx, MeetingBlockersCard.tsx) — each card renders its
 * own full (unsliced) list as `children`, reusing the same row markup as its
 * card preview so the two stay visually consistent.
 */
export function MeetingOverviewListModal({
	title,
	onClose,
	children,
	footer,
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
	footer?: ReactNode;
}) {
	// Esc closes the dialog, like the X button and a click on the backdrop.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
			onClick={onClose}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={title}
				className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-border bg-card p-4 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="mb-3 flex items-center justify-between">
					<h3 className="text-sm font-semibold text-card-foreground">{title}</h3>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
				{footer && <div className="mt-3 shrink-0 border-t border-border pt-3">{footer}</div>}
			</div>
		</div>
	);
}
