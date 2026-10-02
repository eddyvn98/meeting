"use client";

import ProtectedRoute from "@/components/features/auth/protected-route";
import { useToolLayoutSlots } from "@/hooks/use-tool-layout-slots";
import { MeetingAside } from "../components/MeetingAside";
import { MeetingBotPanel } from "../components/MeetingBotPanel";

/**
 * Teams browser bot scheduling: save a Teams link (or paste an invitation),
 * choose a start time and optional recurrence, then let the Linux runner join
 * automatically. Active bot sessions and their recordings stay visible here.
 */
export default function MeetingBotPage() {
	useToolLayoutSlots({ showHistory: false, aside: <MeetingAside /> });

	return (
		<ProtectedRoute>
			<div className="flex h-full w-full flex-col overflow-y-auto px-4 py-6 sm:px-8">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
					<div>
						<h1 className="text-lg font-semibold text-foreground">Scheduled Teams meetings</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							Paste a Teams link or invitation, set the time and repeat rule, and the bot will join automatically. A participant can admit it from the Teams lobby.
						</p>
					</div>
					<MeetingBotPanel activeLimit={20} recentLimit={5} />
				</div>
			</div>
		</ProtectedRoute>
	);
}
