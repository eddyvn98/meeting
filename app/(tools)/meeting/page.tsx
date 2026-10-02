"use client";

import ProtectedRoute from "@/components/features/auth/protected-route";
import { useToolLayoutSlots } from "@/hooks/use-tool-layout-slots";
import { MeetingAside } from "./components/MeetingAside";
import { MeetingHome } from "./components/MeetingHome";

export default function MeetingPage() {
	useToolLayoutSlots({ showHistory: false, aside: <MeetingAside /> });

	return (
		<ProtectedRoute>
			<div className="h-full w-full overflow-y-auto bg-background">
				<MeetingHome />
			</div>
		</ProtectedRoute>
	);
}
