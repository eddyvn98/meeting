"use client";

import ProtectedRoute from "@/components/features/auth/protected-route";
import { useToolLayoutSlots } from "@/hooks/use-tool-layout-slots";
import { MeetingAside } from "../components/MeetingAside";
import { MeetingBotPanel } from "../components/MeetingBotPanel";

/**
 * Teams browser bot management: paste a Teams link to send the bot into a
 * meeting, watch active sessions, stop them, and open the recordings they
 * produced. Reached from the sidebar (under Home) rather than sitting on the
 * Home screen.
 */
export default function MeetingBotPage() {
	useToolLayoutSlots({ showHistory: false, aside: <MeetingAside /> });

	return (
		<ProtectedRoute>
			<div className="flex h-full w-full flex-col overflow-y-auto px-4 py-6 sm:px-8">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
					<div>
						<h1 className="text-lg font-semibold text-foreground">Teams browser bot</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							Send a bot into a Teams meeting to record and transcribe it. Finished sessions appear as normal meetings in your list.
						</p>
					</div>
					<MeetingBotPanel activeLimit={20} recentLimit={5} />
				</div>
			</div>
		</ProtectedRoute>
	);
}
