"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { MinutesTranslation } from "@/lib/meeting/minutesTranslation";
import type { MeetingMinutes } from "@/lib/meeting/types";
import type { AttendanceSectionItem, MinutesMatter } from "@/lib/meeting/overviewSections";
import { resolveMinutesLabels } from "@/lib/meeting/minutesLabels";
import { browserTimeZoneQuery } from "@/lib/meeting/minutesDefaults";
import { MinutesHeader } from "../../(tools)/meeting/[meetingId]/minutes/components/MinutesHeader";
import { AttendanceTable } from "../../(tools)/meeting/[meetingId]/minutes/components/AttendanceTable";
import { MinutesTable } from "../../(tools)/meeting/[meetingId]/minutes/components/MinutesTable";
import { MinutesFooter } from "../../(tools)/meeting/[meetingId]/minutes/components/MinutesFooter";
import { MinutesLanguageBar } from "../../(tools)/meeting/[meetingId]/minutes/components/MinutesLanguageBar";
import { MinutesPrintStyles } from "../../(tools)/meeting/[meetingId]/minutes/components/MinutesPrintStyles";
import { ORIGINAL_VERSION } from "../../(tools)/meeting/[meetingId]/minutes/useMinutesTranslations";

interface PublicMinutes {
	meetingTitle: string;
	minutes: MeetingMinutes;
	attendance: AttendanceSectionItem[];
	matters: MinutesMatter[];
	translations: MinutesTranslation[];
}

const noop = () => undefined;

/** Anonymous, read-only Minutes page opened from a "public link". Sits outside
 *  the (tools) group on purpose: no sign-in, no app chrome. */
export default function PublicMeetingMinutesPage() {
	const params = useParams<{ token: string }>();
	const token = params?.token ?? "";
	const [data, setData] = useState<PublicMinutes | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [language, setLanguage] = useState(ORIGINAL_VERSION);

	useEffect(() => {
		if (!token) return;
		let cancelled = false;
		fetch(`/api/meeting/public/${encodeURIComponent(token)}?${browserTimeZoneQuery()}`)
			.then(async (res) => {
				if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "This share link is invalid or has been turned off");
				return (await res.json()) as PublicMinutes;
			})
			.then((payload) => !cancelled && setData(payload))
			.catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load minutes"));
		return () => {
			cancelled = true;
		};
	}, [token]);

	if (error) {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center gap-1 bg-background px-4 text-center">
				<p className="text-sm font-medium text-foreground">Couldn&apos;t open these minutes</p>
				<p className="text-sm text-muted-foreground">{error}</p>
			</div>
		);
	}
	if (!data) {
		return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Loading minutes…</div>;
	}

	const viewing = data.translations?.find((t) => t.language === language) ?? null;
	const minutes = viewing ? { ...data.minutes, ...viewing.content.header } : data.minutes;
	const attendance = viewing ? viewing.content.attendance : data.attendance;
	const matters = viewing ? viewing.content.matters : data.matters;
	const labels = resolveMinutesLabels(viewing?.content.labels);
	return (
		<div className="min-h-screen bg-muted/30 px-4 py-5 sm:px-6">
			<div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 print:hidden">
				<h1 className="text-sm font-semibold text-foreground">{data.meetingTitle}</h1>
				<span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">View only</span>
			</div>
			<MinutesPrintStyles />
			<MinutesLanguageBar
				translations={data.translations ?? []}
				active={viewing ? language : ORIGINAL_VERSION}
				translating={null}
				canEdit={false}
				onSelect={setLanguage}
				onAdd={noop}
				onRetranslate={noop}
				onDelete={noop}
			/>
			<div id="minutes-print-root" className="mx-auto mt-4 w-full max-w-4xl rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm print:m-0 print:max-w-none print:rounded-none print:border-none print:shadow-none">
				<MinutesHeader labels={labels} minutes={minutes} canEdit={false} onChange={noop} />
				<section className="mt-4 flex flex-col gap-2">
					<h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{labels.attendance}</h2>
					<AttendanceTable labels={labels} items={attendance} suggestions={[]} knownPeople={[]} canEdit={false} onChange={noop} onQueueRole={noop} />
				</section>
				<section className="mt-6 flex flex-col gap-2">
					<h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{labels.minutes}</h2>
					{matters.length === 0 ? <p className="text-sm text-muted-foreground">No minutes have been recorded yet.</p> : <MinutesTable labels={labels} matters={matters} canEdit={false} onChange={noop} />}
				</section>
				<div className="mt-6">
					<MinutesFooter labels={labels} minutes={minutes} canEdit={false} onChange={noop} />
				</div>
			</div>
		</div>
	);
}
