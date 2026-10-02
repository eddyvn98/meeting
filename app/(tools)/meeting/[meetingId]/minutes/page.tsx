"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, FileText, LayoutGrid, Loader2, Printer } from "lucide-react";
import ProtectedRoute from "@/components/features/auth/protected-route";
import { useToolLayoutSlots } from "@/hooks/use-tool-layout-slots";
import { MeetingAside } from "../../components/MeetingAside";
import type { MeetingDetail, MeetingMinutes, OverviewSection } from "@/lib/meeting/types";
import type { AttendanceSectionItem, MinutesMatter } from "@/lib/meeting/overviewSections";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MeetingShareDialog } from "../components/MeetingShareDialog";
import { browserTimeZoneQuery } from "@/lib/meeting/minutesDefaults";
import { useMinutesEditor } from "./useMinutesEditor";
import { MinutesHeader } from "./components/MinutesHeader";
import { AttendanceTable } from "./components/AttendanceTable";
import { MinutesTable } from "./components/MinutesTable";
import { MinutesFooter } from "./components/MinutesFooter";
import { MinutesToolbarButton } from "./components/MinutesToolbarButton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AUTO_MINUTES_LANGUAGE, getStoredMinutesLanguage } from "./components/MinutesLanguageSelect";
import { MinutesGenerateMenu } from "./components/MinutesGenerateMenu";
import { MinutesLanguageBar } from "./components/MinutesLanguageBar";
import { MinutesPrintStyles } from "./components/MinutesPrintStyles";
import { useMinutesTranslations } from "./useMinutesTranslations";
import { resolveMinutesLabels } from "@/lib/meeting/minutesLabels";
import { useMinutesDocxExport } from "./useMinutesDocxExport";
import { useMinutesComments } from "./comments/useMinutesComments";
import { MinutesCommentsProvider } from "./comments/MinutesCommentsContext";

function MinutesBreadcrumb({ meetingId }: { meetingId: string }) {
	return (
		<Link href={`/meeting/${meetingId}`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
			<ChevronLeft className="h-4 w-4" />
			Back to meeting
		</Link>
	);
}

export default function MeetingMinutesPage() {
	const params = useParams<{ meetingId: string }>();
	const meetingId = params?.meetingId ?? "";

	const [detail, setDetail] = useState<MeetingDetail | null>(null);
	const [minutes, setMinutes] = useState<MeetingMinutes | null>(null);
	const [sections, setSections] = useState<OverviewSection[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [minutesLanguage, setMinutesLanguage] = useState(AUTO_MINUTES_LANGUAGE);
	useEffect(() => setMinutesLanguage(getStoredMinutesLanguage()), []);

	useEffect(() => {
		if (!meetingId) return;
		let cancelled = false;
		setError(null);
		Promise.all([
			fetch(`/api/meeting/${meetingId}`).then((r) => (r.ok ? (r.json() as Promise<MeetingDetail>) : Promise.reject(new Error(`Failed to load meeting (${r.status})`)))),
			fetch(`/api/meeting/${meetingId}/minutes?${browserTimeZoneQuery()}`).then((r) => (r.ok ? (r.json() as Promise<MeetingMinutes>) : Promise.reject(new Error(`Failed to load minutes (${r.status})`)))),
		])
			.then(([d, m]) => {
				if (cancelled) return;
				setDetail(d);
				setSections(d.summary?.sections ?? []);
				setMinutes(m);
			})
			.catch((err) => {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : "Failed to load minutes");
			});
		return () => {
			cancelled = true;
		};
	}, [meetingId]);

	useToolLayoutSlots({ showHistory: false, aside: <MeetingAside />, breadcrumb: <MinutesBreadcrumb meetingId={meetingId} /> });

	const commentsApi = useMinutesComments(meetingId);
	const translated = useMinutesTranslations(meetingId);
	const { exporting: exportingDocx, exportDocx: handleExportDocx } = useMinutesDocxExport(meetingId, translated.active);

	const editor = useMinutesEditor({
		meetingId,
		accessRole: detail?.accessRole ?? "viewer",
		sections,
		setSections,
		setMinutes,
	});

	if (error) {
		return (
			<ProtectedRoute>
				<div className="flex h-full flex-col items-center justify-center gap-1 text-center">
					<p className="text-sm font-medium text-foreground">Couldn&apos;t load this meeting&apos;s minutes</p>
					<p className="text-sm text-muted-foreground">{error}</p>
				</div>
			</ProtectedRoute>
		);
	}

	if (!detail || !minutes) {
		return (
			<ProtectedRoute>
				<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading minutes…</div>
			</ProtectedRoute>
		);
	}

	const attendanceSection = sections.find((s) => s.kind === "attendance");
	const mattersSection = sections.find((s) => s.kind === "minutes_table");
	const attendanceItems = (attendanceSection?.items ?? []) as AttendanceSectionItem[];
	const matters = (mattersSection?.items ?? []) as MinutesMatter[];

	const handleGenerateClick = async () => {
		const result = await editor.generate(false, minutesLanguage);
		if (!result.ok && result.needsConfirm) setConfirmOpen(true);
	};

	const startBlank = () => editor.saveMatters([]);

	// What is on screen: the original, or one saved language version. Editing
	// follows what is shown; suggestions and remembered roles only apply to the
	// original, so they never mix languages.
	const viewing = translated.viewing;
	const shownMinutes = viewing ? { ...minutes, ...viewing.content.header } : minutes;
	const shownAttendance = viewing ? viewing.content.attendance : attendanceItems;
	const shownMatters = viewing ? viewing.content.matters : matters;
	const labels = resolveMinutesLabels(viewing?.content.labels);
	const saveStatus = editor.autosaveStatus === "error" ? "error" : editor.autosaveStatus === "saving" || translated.saving ? "saving" : "idle";

	return (
		<ProtectedRoute>
			<div className="flex h-full w-full flex-col overflow-y-auto bg-muted/30 px-4 py-5 sm:px-6">
				<div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-x-3 gap-y-2 print:hidden">
					<div className="flex items-center gap-3">
						<Link
							href={`/meeting/${meetingId}`}
							className="flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
						>
							<LayoutGrid className="h-3.5 w-3.5" />
							Back to Overview
						</Link>
						<h1 className="whitespace-nowrap text-sm font-semibold text-foreground">Minutes of Meeting</h1>
						{saveStatus === "saving" && <span className="text-xs text-muted-foreground">Saving…</span>}
						{saveStatus === "error" && <span className="text-xs text-red-600">Save failed</span>}
					</div>
					<TooltipProvider delayDuration={150}>
						<div className="flex items-center gap-2">
							{editor.canEdit && !viewing && (
								<>
									<MinutesGenerateMenu
										variant="icon"
										language={minutesLanguage}
										onLanguageChange={setMinutesLanguage}
										generating={editor.generating}
										hasExisting={Boolean(mattersSection)}
										onGenerate={handleGenerateClick}
									/>
									<span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
								</>
							)}
							<MinutesToolbarButton label="Print or save as PDF" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()} />
							<MinutesToolbarButton
								label={exportingDocx ? "Exporting Word file…" : "Download Word file (.docx)"}
								icon={exportingDocx ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
								onClick={handleExportDocx}
								disabled={exportingDocx}
							/>
							{detail.accessRole === "owner" && (
								<>
									<span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
									<MeetingShareDialog meetingId={meetingId} iconOnly />
								</>
							)}
						</div>
					</TooltipProvider>
				</div>

				<MinutesLanguageBar
					translations={translated.translations}
					active={translated.active}
					translating={translated.translating}
					canEdit={editor.canEdit}
					onSelect={translated.select}
					onAdd={translated.translate}
					onRetranslate={translated.translate}
					onDelete={translated.remove}
				/>

				<MinutesCommentsProvider value={commentsApi}>
				<div id="minutes-print-root" className="mx-auto mt-4 w-full max-w-4xl rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm print:m-0 print:max-w-none print:rounded-none print:border-none print:shadow-none">
					<MinutesHeader labels={labels} minutes={shownMinutes} canEdit={editor.canEdit} onChange={viewing ? translated.editHeader : editor.updateHeaderField} />

					<section className="mt-4 flex flex-col gap-2">
						<h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{labels.attendance}</h2>
						<AttendanceTable
							labels={labels}
							items={shownAttendance}
							suggestions={viewing ? [] : minutes.attendanceSuggestions}
							knownPeople={viewing ? [] : minutes.knownPeople}
							canEdit={editor.canEdit}
							onChange={viewing ? translated.editAttendance : editor.saveAttendance}
							onQueueRole={viewing ? () => undefined : editor.queueRoleUpdate}
						/>
					</section>

					<section className="mt-6 flex flex-col gap-2">
						<h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{labels.minutes}</h2>
						{!viewing && !mattersSection && !editor.canEdit ? (
							<p className="text-sm text-muted-foreground">No minutes have been recorded yet.</p>
						) : !viewing && !mattersSection ? (
							<div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border p-4 print:hidden">
								<p className="text-sm text-muted-foreground">No minutes table yet for this meeting.</p>
								<div className="flex flex-wrap gap-2">
									<TooltipProvider delayDuration={150}>
										<MinutesGenerateMenu
											variant="button"
											language={minutesLanguage}
											onLanguageChange={setMinutesLanguage}
											generating={editor.generating}
											hasExisting={false}
											onGenerate={handleGenerateClick}
										/>
									</TooltipProvider>
									<button type="button" onClick={startBlank} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
										Start blank
									</button>
								</div>
							</div>
						) : (
							<MinutesTable labels={labels} matters={shownMatters} canEdit={editor.canEdit} onChange={viewing ? translated.editMatters : editor.saveMatters} />
						)}
					</section>

					<div className="mt-6">
						<MinutesFooter labels={labels} minutes={shownMinutes} canEdit={editor.canEdit} onChange={viewing ? translated.editHeader : editor.updateHeaderField} />
					</div>
				</div>
				</MinutesCommentsProvider>
			</div>

			<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Replace manually edited minutes?</AlertDialogTitle>
						<AlertDialogDescription>
							This meeting&apos;s minutes table has manual edits. Regenerating with AI will discard them and replace the table with a fresh AI-generated version.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={async () => {
								setConfirmOpen(false);
								await editor.generate(true, minutesLanguage);
							}}
						>
							Replace
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<MinutesPrintStyles />
		</ProtectedRoute>
	);
}
