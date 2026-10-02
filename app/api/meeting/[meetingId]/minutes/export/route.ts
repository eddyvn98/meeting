import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Meeting as PrismaMeeting } from "@prisma/client";
import { resolveMeetingCallerEmail } from "../../../_auth";
import { resolveMeetingAccess } from "../../../_access";
import type { MeetingMinutes } from "@/lib/meeting/types";
import type { AttendanceSectionItem, MinutesMatter } from "@/lib/meeting/overviewSections";
import { defaultMeetingDateAndTime } from "@/lib/meeting/minutesDefaults";
import { buildMinutesDocx } from "@/lib/meeting/minutesDocx";
import { parseMinutesDocContent } from "@/lib/meeting/minutesTranslation";
import { resolveMinutesLabels } from "@/lib/meeting/minutesLabels";

const EXPORT_FORMATS = ["docx", "pdf"] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];

function isExportFormat(value: string | null): value is ExportFormat {
  return value !== null && (EXPORT_FORMATS as readonly string[]).includes(value);
}

function minutesHeaderFields(meeting: PrismaMeeting, row: Awaited<ReturnType<typeof prisma.meetingMinutes.findUnique>>, timeZone: string | null): MeetingMinutes {
  if (row) {
    return {
      id: row.id,
      meetingId: row.meetingId,
      title: row.title,
      meetingDate: row.meetingDate,
      timeRange: row.timeRange,
      venue: row.venue,
      footnote: row.footnote,
      recordedBy: row.recordedBy,
      recordedDate: row.recordedDate,
      distributed: row.distributed,
      isDefault: false,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      attendanceSuggestions: [],
      knownPeople: [],
    };
  }
  const { meetingDate, timeRange } = defaultMeetingDateAndTime(meeting, timeZone);
  return {
    id: null,
    meetingId: meeting.id,
    title: `MINUTES OF ${meeting.title.toUpperCase()}`,
    meetingDate,
    timeRange,
    venue: null,
    footnote: null,
    recordedBy: null,
    recordedDate: null,
    distributed: null,
    isDefault: true,
    createdAt: null,
    updatedAt: null,
    attendanceSuggestions: [],
    knownPeople: [],
  };
}

/** Builds a filesystem/header-safe filename component from the MOM title:
 *  strips characters that would break a Content-Disposition header or a
 *  common OS filename, collapses whitespace, and caps length so a very
 *  long meeting title doesn't produce an unwieldy download name. Used as
 *  the ASCII `filename=` fallback — see `contentDispositionHeader` for the
 *  RFC 5987 `filename*` companion that preserves non-ASCII characters
 *  (e.g. Vietnamese diacritics) for clients that support it. */
function safeFilenamePart(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return (cleaned || "Minutes").slice(0, 80);
}

/** Builds a Content-Disposition header value with both an ASCII-only
 *  `filename=` fallback (older/non-compliant clients) and an RFC 5987
 *  `filename*=UTF-8''...` value that preserves non-ASCII characters (e.g.
 *  a Vietnamese meeting title) for clients that support it. */
function contentDispositionHeader(asciiName: string, fullName: string): string {
  const encoded = encodeURIComponent(fullName).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}

/** GET /api/meeting/[meetingId]/minutes/export?format=docx|pdf — exports
 *  the MOM as a downloadable .docx. Available to any caller with view
 *  access (owner/editor/viewer — same "any access" rule as GET
 *  .../minutes) since exporting is a read, not an edit. The .docx is
 *  hand-built WordprocessingML zipped with the existing `jszip` dependency
 *  (see lib/meeting/minutesDocx/**) — there is no LibreOffice (or other
 *  HTML->Office converter) available on this server, so `format=pdf` is
 *  not served here; the minutes page's "Export PDF" button instead uses
 *  the browser's own print-to-PDF (window.print) against the same
 *  print-styled page. */
export async function GET(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const format = req.nextUrl.searchParams.get("format");
  if (!isExportFormat(format)) {
    return NextResponse.json({ error: "format must be 'docx' or 'pdf'" }, { status: 400 });
  }

  if (format === "pdf") {
    return NextResponse.json(
      { error: "PDF export is not available from the server. Use the Export PDF button, which prints the page to PDF in your browser." },
      { status: 400 },
    );
  }

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  const accessRole = meeting ? await resolveMeetingAccess(meeting, email) : null;
  if (!meeting || !accessRole) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [minutesRow, summary] = await Promise.all([
    prisma.meetingMinutes.findUnique({ where: { meetingId: meeting.id } }),
    prisma.meetingSummary.findUnique({
      where: { meetingId: meeting.id },
      include: { sections: { orderBy: { order: "asc" } } },
    }),
  ]);

  const attendanceSection = summary?.sections.find((s) => s.kind === "attendance");
  const mattersSection = summary?.sections.find((s) => s.kind === "minutes_table");
  const attendance = (Array.isArray(attendanceSection?.items) ? attendanceSection.items : []) as AttendanceSectionItem[];
  const matters = (Array.isArray(mattersSection?.items) ? mattersSection.items : []) as MinutesMatter[];

  let minutes = minutesHeaderFields(meeting, minutesRow, req.nextUrl.searchParams.get("tz"));
  let exportAttendance = attendance;
  let exportMatters = matters;
  let labels = resolveMinutesLabels();

  // `language` picks a saved language version instead of the original.
  const language = req.nextUrl.searchParams.get("language");
  if (language && language !== "original") {
    const row = await prisma.meetingMinutesTranslation.findUnique({ where: { meetingId_language: { meetingId: meeting.id, language } } });
    const content = row ? parseMinutesDocContent(row.content) : null;
    if (!content) return NextResponse.json({ error: "That language version does not exist" }, { status: 404 });
    minutes = { ...minutes, ...content.header };
    exportAttendance = content.attendance;
    exportMatters = content.matters;
    labels = resolveMinutesLabels(content.labels);
  }

  const languageSuffix = language && language !== "original" ? `-${language}` : "";
  const baseName = `MOM-${safeFilenamePart(minutes.title ?? meeting.title)}-${minutes.meetingDate ?? new Date().toISOString().slice(0, 10)}${languageSuffix}`;
  const docx = await buildMinutesDocx({ minutes, attendance: exportAttendance, matters: exportMatters, labels });

  return new NextResponse(new Uint8Array(docx), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": contentDispositionHeader(`${safeFilenamePart(minutes.title ?? meeting.title)}${languageSuffix}.docx`, `${baseName}.docx`),
    },
  });
}
