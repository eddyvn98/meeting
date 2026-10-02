"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// Maps common MIME types to file extensions for clipboard items that lack a name
export function mimeToExt(mime: string): string {
	const map: Record<string, string> = {
		"image/jpeg": ".jpg",
		"image/jpg": ".jpg",
		"image/png": ".png",
		"image/gif": ".gif",
		"image/webp": ".webp",
		"image/svg+xml": ".svg",
		"application/pdf": ".pdf",
		"text/plain": ".txt",
		"text/csv": ".csv",
		"text/html": ".html",
	};
	return map[mime] ?? ".bin";
}

interface ChatInputProps
	extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
	onSend?: (message: string) => void; // Function to handle sending message
	onPasteFile?: (file: File) => void;
}

const ChatInput = React.forwardRef<HTMLTextAreaElement, ChatInputProps>(
	({ className, onSend, onPasteFile, ...props }, ref) => {
		const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
		const MAX_HEIGHT = 200;

		React.useEffect(() => {
			const el = textareaRef.current;
			if (!el) return;
			el.style.height = "auto";
			if (props.value) {
				el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
			}
		}, [props.value]);

		const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
			const target = e.target;
			target.style.height = "auto";
			const newHeight = Math.min(target.scrollHeight, MAX_HEIGHT);
			target.style.height = `${newHeight}px`;
		};

		const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
			const items = Array.from(e.clipboardData.items);

			for (const item of items) {
				if (item.kind !== "file") continue;
				let file = item.getAsFile();
				if (!file) continue;

				e.preventDefault();

				// Clipboard images (e.g. screenshots) often arrive with an empty name.
				// Give them a proper name derived from their MIME type so downstream
				// extension-based validation can match them correctly.
				if (!file.name) {
					const ext = mimeToExt(file.type);
					file = new File([file], `paste-${Date.now()}${ext}`, {
						type: file.type,
					});
				}

				if (onPasteFile) onPasteFile(file);
				return;
			}
		};

		// ✅ Handle Enter (send) & Shift+Enter (new line)
		const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				if (onSend && textareaRef.current) {
					const value = textareaRef.current.value.trim();
					if (value) {
						onSend(value);
						textareaRef.current.value = ""; // Clear input
						textareaRef.current.style.height = "auto";
					}
				}
			}
		};

		return (
			<textarea
				ref={(node) => {
					textareaRef.current = node;
					if (typeof ref === "function") ref(node);
					else if (ref)
						(
							ref as React.MutableRefObject<HTMLTextAreaElement | null>
						).current = node;
				}}
				rows={1}
				onInput={handleInput}
				onKeyDown={handleKeyDown}
				onPaste={handlePaste}
				className={cn(
					"flex w-full resize-none rounded-lg border border-slate-200 dark:border-slate-700 bg-white/90 py-2 text-base placeholder:text-slate-400 dark:placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
					"overflow-y-auto",
					"focus:outline-none focus:border-slate-400 dark:focus:border-slate-600 transition-colors duration-150",
					className,
				)}
				style={{ maxHeight: `${MAX_HEIGHT}px` }}
				{...props}
			/>
		);
	},
);

ChatInput.displayName = "ChatInput";

export { ChatInput };
