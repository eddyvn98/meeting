"use client";

import { useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Text button that asks for confirmation before discarding the whole recording. */
export function CancelRecordingButton({
	disabled,
	onConfirm,
	className,
}: {
	disabled?: boolean;
	onConfirm: () => void;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button type="button" disabled={disabled} onClick={() => setOpen(true)} className={className}>
				Cancel recording
			</button>
			<AlertDialog open={open} onOpenChange={setOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Cancel this recording?</AlertDialogTitle>
						<AlertDialogDescription>
							Everything recorded so far will be discarded and no meeting will be created. This can&apos;t be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep recording</AlertDialogCancel>
						<AlertDialogAction onClick={onConfirm}>Discard recording</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
