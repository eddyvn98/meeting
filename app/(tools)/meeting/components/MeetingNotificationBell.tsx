"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const POLL_INTERVAL_MS = 20_000;

interface MeetingNotification {
	id: string;
	meetingId: string;
	type: "COMMENT" | "REPLY" | "SHARE_INVITE";
	body: string;
	read: boolean;
	createdAt: string;
}

function formatAgo(iso: string): string {
	const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/** Bell for the Meeting module: new comments, replies and invitations. Polls
 *  every 20s (like the Workspace bell). Opening the bell marks everything read
 *  (the badge clears); clicking an item goes to the Minutes (comments) or the
 *  meeting (invitations). Items can be removed one by one or all at once. */
export function MeetingNotificationBell() {
	const router = useRouter();
	const [items, setItems] = useState<MeetingNotification[]>([]);
	const [open, setOpen] = useState(false);

	const load = useCallback(async () => {
		try {
			const res = await fetch("/api/meeting/notifications", { cache: "no-store" });
			if (res.ok) setItems((await res.json()) as MeetingNotification[]);
		} catch {
			// Best-effort: keep what is shown.
		}
	}, []);

	useEffect(() => {
		void load();
		const timer = setInterval(() => document.visibilityState === "visible" && void load(), POLL_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [load]);

	const unread = items.filter((n) => !n.read).length;

	const openItem = (n: MeetingNotification) => {
		setOpen(false);
		router.push(n.type === "SHARE_INVITE" ? `/meeting/${n.meetingId}` : `/meeting/${n.meetingId}/minutes`);
	};

	const markAllRead = () => {
		if (unread === 0) return;
		setItems((cur) => cur.map((x) => ({ ...x, read: true })));
		void fetch("/api/meeting/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read-all" }) }).catch(() => undefined);
	};

	const handleOpenChange = (next: boolean) => {
		setOpen(next);
		// Seeing the list counts as reading it, so the badge clears on open.
		if (next) markAllRead();
	};

	const remove = (id: string) => {
		setItems((cur) => cur.filter((x) => x.id !== id));
		void fetch(`/api/meeting/notifications/${id}`, { method: "DELETE" }).catch(() => undefined);
	};

	const clearAll = () => {
		setItems([]);
		void fetch("/api/meeting/notifications", { method: "DELETE" }).catch(() => undefined);
	};

	return (
		<DropdownMenu open={open} onOpenChange={handleOpenChange}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					title="Notifications"
					aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
					className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted"
				>
					<Bell className="h-4 w-4" />
					{unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="z-50 max-h-96 w-80 overflow-y-auto rounded-xl p-0">
				<div className="flex items-center justify-between border-b border-border px-3 py-2">
					<span className="text-xs font-bold text-foreground">Notifications</span>
					{items.length > 0 && (
						<button type="button" onClick={clearAll} className="text-[11px] font-semibold text-primary hover:underline">
							Clear all
						</button>
					)}
				</div>
				<div className="divide-y divide-border">
					{items.length === 0 && <p className="px-3 py-4 text-xs text-muted-foreground">No notifications yet.</p>}
					{items.map((n) => (
						<div key={n.id} className={`group/item flex items-start gap-1 hover:bg-muted ${n.read ? "opacity-60" : ""}`}>
							<button type="button" onClick={() => openItem(n)} className="block min-w-0 flex-1 px-3 py-2 text-left text-xs">
								<p className="line-clamp-3 text-foreground">{n.body}</p>
								<span className="text-[10px] text-muted-foreground">{formatAgo(n.createdAt)}</span>
							</button>
							<button type="button" onClick={() => remove(n.id)} title="Delete notification" aria-label="Delete notification" className="mr-1 mt-1.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground">
								<X className="h-3.5 w-3.5" />
							</button>
						</div>
					))}
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
