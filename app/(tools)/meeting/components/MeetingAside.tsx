"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { Bot, BookOpen, Calendar, Home, Search, X } from "lucide-react";
import {
	SidebarProvider,
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuItem,
	SidebarMenuButton,
} from "@/components/ui/sidebar";
import { dayKeyOf, formatDayGroupLabel } from "@/lib/meeting/format";
import type { Meeting } from "@/lib/meeting/types";
import { onMeetingRenamed, onMeetingsChanged } from "@/lib/meeting/meetingEvents";
import { useAudioRetentionDays } from "@/lib/meeting/useAudioRetentionDays";
import { useMeetingGroups } from "@/lib/meeting/useMeetingGroups";
import { MeetingNotificationBell } from "./MeetingNotificationBell";
import { MeetingAsideRecentItem } from "./MeetingAsideRecentItem";
import { MeetingAsideGroupList } from "./MeetingAsideGroupList";
import { useMeetingActivity } from "@/lib/meeting/meetingActivityLock";

interface MeetingNavItem {
	label: string;
	href: string;
	icon: typeof Home;
	isActive: (pathname: string) => boolean;
}

const NAV_ITEMS: MeetingNavItem[] = [
	{ label: "Home", href: "/meeting", icon: Home, isActive: (p) => p === "/meeting" },
	{ label: "Browser bot", href: "/meeting/bot", icon: Bot, isActive: (p) => p === "/meeting/bot" },
	{ label: "Glossary", href: "/meeting/glossary", icon: BookOpen, isActive: (p) => p === "/meeting/glossary" },
];

const RECENT_LIMIT = 8;
const SEARCH_DEBOUNCE_MS = 300;

function groupByDay(meetings: Meeting[]): { key: string; label: string; meetings: Meeting[] }[] {
	const groups = new Map<string, Meeting[]>();
	for (const meeting of meetings) {
		const key = dayKeyOf(meeting.createdAt);
		const bucket = groups.get(key);
		if (bucket) bucket.push(meeting);
		else groups.set(key, [meeting]);
	}
	return Array.from(groups.entries()).map(([key, group]) => ({
		key,
		label: formatDayGroupLabel(group[0].createdAt),
		meetings: group,
	}));
}

/**
 * Meeting-specific left aside content: Home/Meetings nav and a
 * searchable/filterable Recent list — laid out as
 * an h-full flex column with its OWN internal scroll region around just the
 * Recent list, so nav/search stay fixed in place no matter how
 * long the Recent list gets (ToolLayout's shared <aside> shell —
 * components/layouts/tool-layout.tsx — still carries its own
 * `overflow-y-auto`, but that no longer matters here since this component's
 * rendered height always exactly fills it instead of exceeding it).
 */
export function MeetingAside() {
	const pathname = usePathname();
	const params = useParams<{ meetingId?: string }>();
	const activeMeetingId = params?.meetingId;
	const activity = useMeetingActivity();
	const sidebarLocked = activity !== null;
	const sidebarContentRef = useRef<HTMLDivElement | null>(null);

	const [allMeetings, setAllMeetings] = useState<Meeting[]>([]);
	const [searchResults, setSearchResults] = useState<Meeting[] | null>(null);
	const [query, setQuery] = useState("");
	const [dateFilter, setDateFilter] = useState("");
	const [openFilter, setOpenFilter] = useState<"search" | "date" | null>(null);
	const retentionDays = useAudioRetentionDays();
	const { groups, createGroup, renameGroup, deleteGroup } = useMeetingGroups();

	useEffect(() => {
		const element = sidebarContentRef.current;
		if (!element) return;
		element.inert = sidebarLocked;
		if (sidebarLocked) element.querySelector<HTMLElement>(":focus")?.blur();
	}, [sidebarLocked]);

	// Patches a title in place the instant it's renamed from the result page
	// (MeetingResultHeader.tsx), instead of waiting for this list's own fetch
	// (which only re-runs on `pathname` change and won't fire while staying
	// on that same meeting's page).
	useEffect(() => {
		return onMeetingRenamed((meetingId, title) => {
			const patch = (list: Meeting[]) => list.map((m) => (m.id === meetingId ? { ...m, title } : m));
			setAllMeetings(patch);
			setSearchResults((prev) => (prev ? patch(prev) : prev));
		});
	}, []);

	// Unfiltered list — always the full set (not just the RECENT_LIMIT-sliced
	// view), so search/date filtering doesn't miss anything. Fetches once on
	// mount (this component persists across meeting-to-meeting
	// navigation — the aside slot isn't recreated per page) rather than on
	// every `pathname` change, which used to re-fetch the whole list every
	// single time you switched meetings even though it almost never changed.
	// Explicitly refreshed instead on onMeetingsChanged (a new meeting was
	// just created — see meetingEvents.ts) and on rename (below, patched in
	// place, no fetch needed).
	useEffect(() => {
		let cancelled = false;
		// onMeetingsChanged can fire fetchAll() again before an earlier call's
		// response lands (e.g. two meetings created back to back) — a plain
		// `cancelled` flag only guards against the effect unmounting, not
		// against an older in-flight call's response overwriting a newer
		// one's. This counter lets each call recognize whether it's still the
		// most recent before applying its result.
		let requestToken = 0;
		const fetchAll = () => {
			const token = ++requestToken;
			fetch("/api/meeting")
				.then((res) => (res.ok ? (res.json() as Promise<Meeting[]>) : []))
				.then((meetings) => {
					if (!cancelled && token === requestToken) setAllMeetings(meetings);
				})
				.catch(() => undefined);
		};
		fetchAll();
		const unsubscribe = onMeetingsChanged(fetchAll);
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	// Server-side search (title + transcript content) + date filter, debounced.
	useEffect(() => {
		const q = query.trim();
		if (!q && !dateFilter) {
			setSearchResults(null);
			return;
		}
		let cancelled = false;
		const timer = setTimeout(() => {
			const params = new URLSearchParams();
			if (q) params.set("q", q);
			if (dateFilter) params.set("date", dateFilter);
			fetch(`/api/meeting?${params.toString()}`)
				.then((res) => (res.ok ? (res.json() as Promise<Meeting[]>) : []))
				.then((meetings) => {
					if (!cancelled) setSearchResults(meetings);
				})
				.catch(() => undefined);
		}, SEARCH_DEBOUNCE_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [query, dateFilter]);

	const isFiltering = searchResults !== null;
	// Groups (below) render their own members directly from allMeetings, so
	// this plain day-grouped list only needs whatever's left ungrouped —
	// otherwise a meeting filed into a folder would show up twice.
	const visibleMeetings = isFiltering ? searchResults : allMeetings.filter((m) => !m.groupId).slice(0, RECENT_LIMIT);
	const dayGroups = useMemo(() => groupByDay(visibleMeetings), [visibleMeetings]);

	const handleDeleted = (id: string) => {
		setAllMeetings((prev) => prev.filter((m) => m.id !== id));
		setSearchResults((prev) => (prev ? prev.filter((m) => m.id !== id) : prev));
	};

	const handleMoved = (id: string, groupId: string | null) => {
		const patch = (list: Meeting[]) => list.map((m) => (m.id === id ? { ...m, groupId } : m));
		setAllMeetings(patch);
		setSearchResults((prev) => (prev ? patch(prev) : prev));
	};

	return (
		<SidebarProvider className="meeting-app relative flex h-full min-h-0 w-full flex-col">
				<div
					ref={sidebarContentRef}
					aria-disabled={sidebarLocked}
					aria-hidden={sidebarLocked}
					className={`flex min-h-0 flex-1 flex-col ${sidebarLocked ? "pointer-events-none select-none opacity-60" : ""}`}
			>
				<div className="flex w-full shrink-0 flex-col gap-3 p-3 pb-0">
				<div className="flex items-center justify-between px-1">
					<span className="text-xs font-semibold text-muted-foreground">Meeting</span>
					<MeetingNotificationBell />
				</div>
				<SidebarGroup className="p-0">
					<SidebarGroupContent>
						<SidebarMenu>
							{NAV_ITEMS.map((item) => {
								const isActive = item.isActive(pathname ?? "");
								const Icon = item.icon;
								return (
									<SidebarMenuItem key={item.label}>
										{/* isActive intentionally NOT passed to SidebarMenuButton: its cva
										    variants bake in a data-[active=true]:bg-sidebar-accent
										    background we don't want here (orange text only, no fill). */}
										<SidebarMenuButton asChild>
											<Link
												href={item.href}
												className={`flex items-center gap-2 ${
													isActive
														? "text-primary font-semibold"
														: "text-muted-foreground hover:bg-sidebar-hover hover:text-foreground dark:hover:bg-slate-800"
												}`}
											>
												<Icon className="h-4 w-4 shrink-0" />
												<span>{item.label}</span>
											</Link>
										</SidebarMenuButton>
									</SidebarMenuItem>
								);
							})}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>

				<div className="flex flex-col gap-1.5">
					<div className="flex items-center gap-1.5">
						<button
							type="button"
							onClick={() => setOpenFilter((prev) => (prev === "search" ? null : "search"))}
							aria-label="Search title or transcript"
							title="Search title or transcript"
							className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${
								openFilter === "search" || query
									? "bg-muted text-foreground"
									: "text-muted-foreground hover:bg-sidebar-hover hover:text-foreground dark:hover:bg-slate-800"
							}`}
						>
							<Search className="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							onClick={() => setOpenFilter((prev) => (prev === "date" ? null : "date"))}
							aria-label="Filter by date"
							title="Filter by date"
							className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${
								openFilter === "date" || dateFilter
									? "bg-muted text-foreground"
									: "text-muted-foreground hover:bg-sidebar-hover hover:text-foreground dark:hover:bg-slate-800"
							}`}
						>
							<Calendar className="h-3.5 w-3.5" />
						</button>
						{(query || dateFilter) && (
							<button
								type="button"
								onClick={() => {
									setQuery("");
									setDateFilter("");
									setOpenFilter(null);
								}}
								aria-label="Clear filters"
								title="Clear filters"
								className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
							>
								<X className="h-3.5 w-3.5" />
							</button>
						)}
					</div>
					{openFilter === "search" && (
						<input
							autoFocus
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search title or transcript…"
							className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground"
						/>
					)}
					{openFilter === "date" && (
						<input
							autoFocus
							type="date"
							value={dateFilter}
							onChange={(e) => setDateFilter(e.target.value)}
							className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none"
						/>
					)}
				</div>
				</div>

			{/* Only this region scrolls — nav and search/date filter above stay
			    fixed regardless of how long this list
			    gets (see the component doc comment). */}
			<div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
				<div className="flex flex-col gap-3">
					{!isFiltering && (
						<MeetingAsideGroupList
							groups={groups}
							onCreate={createGroup}
							onRename={renameGroup}
							onDelete={deleteGroup}
							meetings={allMeetings}
							activeMeetingId={activeMeetingId}
							retentionDays={retentionDays}
							onMeetingMoved={handleMoved}
							onMeetingDeleted={handleDeleted}
						/>
					)}
					<div className="flex flex-col gap-2">
						{dayGroups.length === 0 ? (
							<p className="px-2 text-xs text-muted-foreground">
								{isFiltering ? "No meetings match." : "No meetings yet."}
							</p>
						) : (
							dayGroups.map((group) => (
								<div key={group.key}>
									<p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{group.label}</p>
									<ul className="flex flex-col gap-0.5">
										{group.meetings.map((meeting) => (
											<MeetingAsideRecentItem
												key={meeting.id}
												meeting={meeting}
												isActive={meeting.id === activeMeetingId}
												onDeleted={handleDeleted}
												retentionDays={retentionDays}
												groups={groups}
												onMoved={handleMoved}
											/>
										))}
									</ul>
								</div>
							))
						)}
					</div>
				</div>
			</div>
			</div>
			{sidebarLocked && (
				<div
					data-meeting-sidebar-lock
					className="absolute inset-0 z-30 flex items-end justify-center bg-background/10 p-3 text-center"
					role="status"
				>
					<span className="rounded-md bg-card/95 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm">
						{activity === "recording" ? "Meeting recording is active" : "Meeting upload is in progress"}
					</span>
				</div>
			)}
		</SidebarProvider>
	);
}
