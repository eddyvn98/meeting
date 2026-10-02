"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Globe, Loader2 } from "lucide-react";

interface PublicShareState {
	enabled: boolean;
	token: string | null;
}

/** "Anyone with the link can view" toggle for the Minutes page. The public
 *  page is read-only and needs no login, so it cannot be commented on; people
 *  who should comment are invited by email in the list above instead. */
export function MeetingPublicLinkSection({ meetingId }: { meetingId: string }) {
	const [state, setState] = useState<PublicShareState | null>(null);
	const [busy, setBusy] = useState(false);
	const [copied, setCopied] = useState(false);
	const url = `/api/meeting/${meetingId}/public-share`;

	useEffect(() => {
		let cancelled = false;
		fetch(url)
			.then((r) => (r.ok ? (r.json() as Promise<PublicShareState>) : null))
			.then((data) => {
				if (!cancelled && data) setState(data);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [url]);

	const change = useCallback(
		async (method: "POST" | "DELETE", body?: object) => {
			setBusy(true);
			try {
				const res = await fetch(url, {
					method,
					headers: { "Content-Type": "application/json" },
					body: body ? JSON.stringify(body) : undefined,
				});
				if (res.ok) setState((await res.json()) as PublicShareState);
			} finally {
				setBusy(false);
			}
		},
		[url],
	);

	const link = state?.enabled && state.token ? `${window.location.origin}/meeting-view/${state.token}` : null;

	const copy = async () => {
		if (!link) return;
		try {
			await navigator.clipboard.writeText(link);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard blocked: the link is selectable in the field below.
		}
	};

	return (
		<div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
					<Globe className="h-3.5 w-3.5" />
					Public link (view only)
				</div>
				<button
					type="button"
					role="switch"
					aria-checked={Boolean(link)}
					aria-label="Public link"
					disabled={busy || state === null}
					onClick={() => (link ? change("DELETE") : change("POST"))}
					className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60 ${link ? "bg-primary" : "bg-muted-foreground/40"}`}
				>
					{busy ? (
						<Loader2 className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 animate-spin text-white" />
					) : (
						<span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${link ? "left-[18px]" : "left-0.5"}`} />
					)}
				</button>
			</div>
			<p className="text-[11px] text-muted-foreground">
				{link ? "Anyone with this link can read the minutes without signing in. They cannot comment or edit." : "Off — only invited people can open this meeting."}
			</p>
			{link && (
				<>
					<div className="flex items-center gap-1.5">
						<input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Public link URL" className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none" />
						<button type="button" onClick={copy} className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
							{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
							{copied ? "Copied" : "Copy"}
						</button>
					</div>
					<button type="button" disabled={busy} onClick={() => change("POST", { rotate: true })} className="self-start text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-60">
						Reset link (the old link stops working)
					</button>
				</>
			)}
		</div>
	);
}
