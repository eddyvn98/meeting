import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { resolveMeetingAccess } from "../../_access";
import { requireMeetingEditor } from "../sections/_shared";
import { UNKNOWN_SPEAKER_NAME, type AttendanceSuggestion, type MeetingMinutes, type UpdateMeetingMinutesInput } from "@/lib/meeting/types";
import { defaultMeetingDateAndTime } from "@/lib/meeting/minutesDefaults";
import type { MeetingMinutes as PrismaMeetingMinutes, Meeting as PrismaMeeting } from "@prisma/client";
import { buildRosterAttendanceDefaults } from "@/lib/meeting/bot/attendance";

const normalizeName = (name: string) => name.trim().toLowerCase();

/** Named-speaker attendance suggestions for `meeting`, with role filled
 *  from this owner's remembered MeetingPersonRole where one exists — see
 *  MeetingMinutes.attendanceSuggestions' doc comment in lib/meeting/types.ts.
 *  Every SpeakerMapping row is, by construction, an explicit rename (see
 *  PUT .../speakers), so all of them count as "named" except the reserved
 *  "Unknown" (deleted-speaker) sentinel. */
async function buildAttendanceSuggestions(meeting: PrismaMeeting): Promise<AttendanceSuggestion[]> {
  const mappings = await prisma.speakerMapping.findMany({
    where: { meetingId: meeting.id, displayName: { not: UNKNOWN_SPEAKER_NAME } },
    orderBy: { updatedAt: "asc" },
  });
  if (mappings.length === 0) return [];

  const roles = await prisma.meetingPersonRole.findMany({
    where: { ownerEmail: meeting.ownerEmail.toLowerCase(), normalizedName: { in: mappings.map((m) => normalizeName(m.displayName)) } },
  });
  const roleByName = new Map(roles.map((r) => [r.normalizedName, r]));

  // A speakerKey can technically be renamed to the same displayName as
  // another (two "John"s in one meeting) — dedupe by normalized name so
  // the suggestion list doesn't offer the same attendee twice.
  const seen = new Set<string>();
  const suggestions: AttendanceSuggestion[] = [];
  for (const mapping of mappings) {
    const key = normalizeName(mapping.displayName);
    if (seen.has(key)) continue;
    seen.add(key);
    const known = roleByName.get(key);
    suggestions.push({ name: mapping.displayName, role: known?.role ?? null, organization: known?.organization ?? null });
  }
  return suggestions;
}

/** Everyone this owner has saved a role/organization for (most recent first). */
async function buildKnownPeople(meeting: PrismaMeeting): Promise<AttendanceSuggestion[]> {
  const rows = await prisma.meetingPersonRole.findMany({
    where: { ownerEmail: meeting.ownerEmail.toLowerCase() },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
  return rows.map((r) => ({ name: r.displayName ?? r.normalizedName, role: r.role || null, organization: r.organization ?? null }));
}

async function buildResponse(meeting: PrismaMeeting, row: PrismaMeetingMinutes | null, timeZone: string | null): Promise<MeetingMinutes> {
  const [attendanceSuggestions, knownPeople, botSession] = await Promise.all([
    buildAttendanceSuggestions(meeting),
    buildKnownPeople(meeting),
    prisma.meetingBotSession.findUnique({
      where: { meetingId: meeting.id },
      select: { participantNames: true },
    }),
  ]);
  const attendanceDefaults = buildRosterAttendanceDefaults(
    botSession?.participantNames ?? [],
    knownPeople,
  );
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
      attendanceSuggestions,
      attendanceDefaults,
      knownPeople,
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
    attendanceSuggestions,
    attendanceDefaults,
    knownPeople,
  };
}

/** GET /api/meeting/[meetingId]/minutes — MOM header/footer metadata.
 *  Available to the owner AND anyone with an active MeetingShare grant
 *  (same "any access" rule as GET .../ask's transcript read) — a shared
 *  viewer can read the MOM metadata even though only the owner can save
 *  it (see PATCH below). Never 404s on a meeting that simply has no
 *  MeetingMinutes row yet — see buildResponse's `isDefault` branch. */
export async function GET(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  const accessRole = meeting ? await resolveMeetingAccess(meeting, email) : null;
  if (!meeting || !accessRole) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const row = await prisma.meetingMinutes.findUnique({ where: { meetingId: meeting.id } });
  return NextResponse.json(await buildResponse(meeting, row, req.nextUrl.searchParams.get("tz")));
}

/** One `{ name, role, organization }` entry from the attendance editor —
 *  saved into MeetingPersonRole (keyed by owner + normalized name) so future
 *  meetings remember that person. A blank field is skipped (never overwrites
 *  a remembered value with nothing), and an entry with neither a role nor an
 *  organization is ignored. */
interface RoleUpdate {
  name: string;
  role?: string;
  organization?: string;
}

function parseRoleUpdates(raw: unknown): RoleUpdate[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const updates: RoleUpdate[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const { name, role, organization } = entry as Record<string, unknown>;
    if (typeof name !== "string" || (role !== undefined && typeof role !== "string") || (organization !== undefined && typeof organization !== "string")) return null;
    const cleanRole = typeof role === "string" ? role.trim() : "";
    const cleanOrganization = typeof organization === "string" ? organization.trim() : "";
    if (name.trim() && (cleanRole || cleanOrganization)) {
      updates.push({ name: name.trim(), ...(cleanRole ? { role: cleanRole } : {}), ...(cleanOrganization ? { organization: cleanOrganization } : {}) });
    }
  }
  return updates;
}

/** PATCH /api/meeting/[meetingId]/minutes — owner or editor (reuses
 *  requireMeetingEditor, same rule as the section-editing routes). Upserts
 *  the MeetingMinutes row; only fields present in the body are changed
 *  (omitted fields keep their current/null value on create, current value
 *  on update — same "only touch what's present" convention as PATCH
 *  .../sections/[sectionId]). An explicit `null` clears a field.
 *
 *  Also accepts an optional `roleUpdates: { name, role }[]` — the Stage B
 *  attendance editor's "save role" action — upserted into
 *  MeetingPersonRole in the same request rather than a separate endpoint,
 *  so saving an attendee's role is one round trip. */
export async function PATCH(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const auth = await requireMeetingEditor(req, params.meetingId);
  if (!auth.ok) return auth.response;

  let body: UpdateMeetingMinutesInput & { roleUpdates?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const roleUpdates = parseRoleUpdates(body.roleUpdates);
  if (roleUpdates === null) {
    return NextResponse.json({ error: "roleUpdates must be an array of { name, role?, organization? } strings" }, { status: 400 });
  }

  const fields = ["title", "meetingDate", "timeRange", "venue", "footnote", "recordedBy", "recordedDate", "distributed"] as const;
  const data: Partial<Record<(typeof fields)[number], string | null>> = {};
  for (const field of fields) {
    if (field in body) {
      const value = body[field];
      if (value !== null && typeof value !== "string") {
        return NextResponse.json({ error: `${field} must be a string or null` }, { status: 400 });
      }
      data[field] = value ?? null;
    }
  }

  const ownerEmail = auth.meeting.ownerEmail.toLowerCase();
  for (const { name, role, organization } of roleUpdates) {
    const normalizedName = normalizeName(name);
    await prisma.meetingPersonRole.upsert({
      where: { ownerEmail_normalizedName: { ownerEmail, normalizedName } },
      create: { ownerEmail, normalizedName, displayName: name, role: role ?? "", organization: organization ?? null },
      update: { displayName: name, ...(role ? { role } : {}), ...(organization ? { organization } : {}) },
    });
  }

  // On the very first edit there is no MeetingMinutes row yet, so `create`
  // below only carries whichever single field the caller just changed (e.g.
  // venue). Any header field the caller didn't touch must still start from
  // the same computed defaults buildResponse()'s `isDefault` branch shows
  // before any row exists (title from the meeting's own title, date/time
  // from its createdAt/duration) — otherwise that first edit would silently
  // blank out the title/date/time the user was already looking at.
  const { meetingDate: defaultMeetingDate, timeRange: defaultTimeRange } = defaultMeetingDateAndTime(auth.meeting, req.nextUrl.searchParams.get("tz"));
  const createDefaults = {
    title: `MINUTES OF ${auth.meeting.title.toUpperCase()}`,
    meetingDate: defaultMeetingDate,
    timeRange: defaultTimeRange,
  };

  const row =
    Object.keys(data).length > 0
      ? await prisma.meetingMinutes.upsert({
          where: { meetingId: auth.meeting.id },
          create: { meetingId: auth.meeting.id, ...createDefaults, ...data },
          update: data,
        })
      : await prisma.meetingMinutes.findUnique({ where: { meetingId: auth.meeting.id } });

  return NextResponse.json(await buildResponse(auth.meeting, row, req.nextUrl.searchParams.get("tz")));
}
