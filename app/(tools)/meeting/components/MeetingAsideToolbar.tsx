"use client";

import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import { BookOpen, Bot, Calendar, Home, Search, X } from "lucide-react";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuItem,
	SidebarMenuButton,
} from "@/components/ui/sidebar";
import { MeetingNotificationBell } from "./MeetingNotificationBell";

type FilterPanel = "search" | "date" | null;

const NAV_ITEMS = [
	{ label: "Home", href: "/meeting", icon: Home, isActive: (path: string) => path === "/meeting" },
	{ label: "Browser bot", href: "/meeting/bot", icon: Bot, isActive: (path: string) => path === "/meeting/bot" },
	{ label: "Glossary", href: "/meeting/glossary", icon: BookOpen, isActive: (path: string) => path === "/meeting/glossary" },
];

interface MeetingAsideToolbarProps {
	pathname: string;
	openFilter: FilterPanel;
	onOpenFilterChange: Dispatch<SetStateAction<FilterPanel>>;
	query: string;
	onQueryChange: (value: string) => void;
	dateFilter: string;
	onDateFilterChange: (value: string) => void;
}

export function MeetingAsideToolbar({
	pathname,
	openFilter,
	onOpenFilterChange,
	query,
	onQueryChange,
	dateFilter,
	onDateFilterChange,
}: MeetingAsideToolbarProps) {
	return (
		<div className="flex w-full shrink-0 flex-col gap-3 p-3 pb-0">
			<div className="flex items-center justify-between px-1">
				<span className="text-xs font-semibold text-muted-foreground">Meeting</span>
				<MeetingNotificationBell />
			</div>
			<SidebarGroup className="p-0">
				<SidebarGroupContent>
					<SidebarMenu>
						{NAV_ITEMS.map((item) => {
							const isActive = item.isActive(pathname);
							const Icon = item.icon;
							return (
								<SidebarMenuItem key={item.label}>
									<SidebarMenuButton asChild>
										<Link
											href={item.href}
											className={`flex items-center gap-2 ${isActive
												? "text-brand-orange font-semibold"
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
					<button type="button" onClick={() => onOpenFilterChange((prev) => prev === "search" ? null : "search")}
						aria-label="Search title or transcript" title="Search title or transcript"
						className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${openFilter === "search" || query ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-sidebar-hover hover:text-foreground dark:hover:bg-slate-800"}`}>
						<Search className="h-3.5 w-3.5" />
					</button>
					<button type="button" onClick={() => onOpenFilterChange((prev) => prev === "date" ? null : "date")}
						aria-label="Filter by date" title="Filter by date"
						className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${openFilter === "date" || dateFilter ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-sidebar-hover hover:text-foreground dark:hover:bg-slate-800"}`}>
						<Calendar className="h-3.5 w-3.5" />
					</button>
					{(query || dateFilter) && (
						<button type="button" onClick={() => {
							onQueryChange("");
							onDateFilterChange("");
							onOpenFilterChange(null);
						}} aria-label="Clear filters" title="Clear filters"
							className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
							<X className="h-3.5 w-3.5" />
						</button>
					)}
				</div>
				{openFilter === "search" && <input autoFocus value={query} onChange={(event) => onQueryChange(event.target.value)}
					placeholder="Search title or transcript…"
					className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground" />}
				{openFilter === "date" && <input autoFocus type="date" value={dateFilter} onChange={(event) => onDateFilterChange(event.target.value)}
					className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none" />}
			</div>
		</div>
	);
}
