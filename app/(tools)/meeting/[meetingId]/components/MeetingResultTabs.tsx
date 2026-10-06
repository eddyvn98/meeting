"use client";

import { FileText, LayoutGrid } from "lucide-react";

// "ask" stays a valid tab id (page.tsx still recognizes ?tab=ask as a deep
// link — it opens the floating Ask AI chat bubble instead of a tab) even
// though it's no longer in this bar; see AskChatBubble.tsx.
export type MeetingResultTab = "overview" | "transcript" | "ask";

const TABS: { id: Exclude<MeetingResultTab, "ask">; label: string; icon: typeof LayoutGrid }[] = [
	{ id: "overview", label: "Overview", icon: LayoutGrid },
	{ id: "transcript", label: "Transcript", icon: FileText },
];

/**
 * Overview / Transcript tab bar for the Meeting Result screen. "Ask" used
 * to be a third tab here — it's now the floating AskChatBubble instead
 * (Messenger-style chat bubble, draggable, always available regardless of
 * which tab is active).
 */
export function MeetingResultTabs({
	activeTab,
	onChange,
}: {
	activeTab: MeetingResultTab;
	onChange: (tab: MeetingResultTab) => void;
}) {
	return (
		<nav
			className="flex shrink-0 border-t border-border bg-card"
			aria-label="Meeting result tabs"
		>
			{TABS.map((tab) => {
				const isActive = tab.id === activeTab;
				const Icon = tab.icon;
				return (
					<button
						key={tab.id}
						type="button"
						onClick={() => onChange(tab.id)}
						className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors ${
							isActive ? "text-brand-orange" : "text-muted-foreground hover:text-foreground"
						}`}
						aria-current={isActive ? "page" : undefined}
					>
						<Icon className="h-4 w-4" />
						{tab.label}
					</button>
				);
			})}
		</nav>
	);
}
