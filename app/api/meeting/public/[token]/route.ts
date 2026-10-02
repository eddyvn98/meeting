/**
 * Anonymous, read-only Minutes for a meeting whose owner switched on the
 * public link. The token is the only credential, so this route never calls
 * resolveMeetingCallerEmail and exposes GET only. It returns just the MOM
 * document (header, attendance, matters, saved language versions) — no transcript, audio, people
 * suggestions or comments.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { defaultMeetingDateAndTime } from "@/lib/meeting/minutesDefaults";
import { toClientTranslation } from "@/lib/meeting/minutesSource";
import type { MinutesTranslation } from "@/lib/meeting/minutesTranslation";

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  if (!params.token) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const meeting = await prisma.meeting.findUnique({ where: { publicShareToken: params.token } });
  if (!meeting || !meeting.publicShareEnabled) {
    return NextResponse.json({ error: "This share link is invalid or has been turned off" }, { status: 404 });
  }

  const [row, sections, translationRows] = await Promise.all([
    prisma.meetingMinutes.findUnique({ where: { meetingId: meeting.id } }),
    prisma.meetingOverviewSection.findMany({
      where: { summary: { meetingId: meeting.id }, kind: { in: ["attendance", "minutes_table"] } },
      orderBy: { order: "asc" },
    }),
    prisma.meetingMinutesTranslation.findMany({ where: { meetingId: meeting.id }, orderBy: { createdAt: "asc" } }),
  ]);

  const timeZone = req.nextUrl.searchParams.get("timeZone");
  const defaults = defaultMeetingDateAndTime(meeting, timeZone);
  const items = (kind: string) => {
    const found = sections.find((s) => s.kind === kind);
    return found && Array.isArray(found.items) ? found.items : [];
  };

  // Saved language versions, so a public reader can switch language. The stale
  // flag is an editor concern and is not shown to anonymous readers.
  const translations = translationRows
    .map((r) => toClientTranslation(r, new Date(0)))
    .filter((x): x is MinutesTranslation => x !== null);

  return NextResponse.json({
    translations,
    meetingTitle: meeting.title,
    minutes: {
      id: row?.id ?? null,
      meetingId: meeting.id,
      title: row?.title ?? `MINUTES OF ${meeting.title.toUpperCase()}`,
      meetingDate: row ? row.meetingDate : defaults.meetingDate,
      timeRange: row ? row.timeRange : defaults.timeRange,
      venue: row?.venue ?? null,
      footnote: row?.footnote ?? null,
      recordedBy: row?.recordedBy ?? null,
      recordedDate: row?.recordedDate ?? null,
      distributed: row?.distributed ?? null,
      isDefault: !row,
      createdAt: row?.createdAt.toISOString() ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      attendanceSuggestions: [],
      knownPeople: [],
    },
    attendance: items("attendance"),
    matters: items("minutes_table"),
  });
}
