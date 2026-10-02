import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMeetingEditor } from "../_shared";
import { serializeOverviewSection } from "@/lib/meeting/serialize";

/** PATCH /api/meeting/[meetingId]/sections/reorder — body `{ ids: string[] }`,
 *  the section ids in their new display order (Overview tab's up/down
 *  reorder buttons). Every id must belong to this meeting's own summary AND
 *  the set must be exactly its current sections (no dropping/adding ids
 *  through this route) — otherwise 400, so a partial/stale list from the
 *  client can never silently orphan a section's order. Applied in one
 *  transaction; owner-only. */
export async function PATCH(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const auth = await requireMeetingEditor(req, params.meetingId);
  if (!auth.ok) return auth.response;

  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "ids must be an array of section ids" }, { status: 400 });
  }
  const ids = body.ids as string[];

  const existing = await prisma.meetingOverviewSection.findMany({ where: { summaryId: auth.summary.id } });
  const existingIds = new Set(existing.map((s) => s.id));
  const sameSet = ids.length === existing.length && ids.every((id) => existingIds.has(id)) && new Set(ids).size === ids.length;
  if (!sameSet) {
    return NextResponse.json({ error: "ids must be exactly this meeting's current section ids, each once" }, { status: 400 });
  }

  const updated = await prisma.$transaction(
    ids.map((id, index) =>
      prisma.meetingOverviewSection.update({ where: { id }, data: { order: index } }),
    ),
  );

  return NextResponse.json(updated.sort((a, b) => a.order - b.order).map(serializeOverviewSection));
}
