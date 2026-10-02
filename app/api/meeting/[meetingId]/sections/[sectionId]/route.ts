import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireMeetingEditor } from "../_shared";
import { serializeOverviewSection } from "@/lib/meeting/serialize";
import { isOverviewSectionKind, validateSectionItemsForWrite } from "@/lib/meeting/overviewSections";

/** Loads `sectionId`, 404ing unless it belongs to this meeting's own
 *  MeetingSummary — otherwise a caller who owns meeting A could edit/delete
 *  a section that actually belongs to meeting B just by knowing its id. */
async function loadOwnedSection(summaryId: string, sectionId: string) {
  const section = await prisma.meetingOverviewSection.findUnique({ where: { id: sectionId } });
  if (!section || section.summaryId !== summaryId) return null;
  return section;
}

/** PATCH /api/meeting/[meetingId]/sections/[sectionId] — edits a section's
 *  title, items, and/or order (inline rename, add/edit/delete item, and the
 *  reorder buttons all funnel through this one route — only whichever
 *  field(s) are present in the body are changed). `items`, if present, is
 *  validated against the section's OWN kind (kind itself is immutable here).
 *  Owner-only; always sets `source: "user"`. */
export async function PATCH(req: NextRequest, { params }: { params: { meetingId: string; sectionId: string } }) {
  const auth = await requireMeetingEditor(req, params.meetingId);
  if (!auth.ok) return auth.response;

  const section = await loadOwnedSection(auth.summary.id, params.sectionId);
  if (!section) return NextResponse.json({ error: "Section not found" }, { status: 404 });

  let body: { title?: unknown; items?: unknown; order?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: Prisma.MeetingOverviewSectionUpdateInput = { source: "user" };

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    data.title = title;
  }

  if (body.items !== undefined) {
    if (!isOverviewSectionKind(section.kind)) {
      return NextResponse.json({ error: "This section's kind is no longer recognized" }, { status: 400 });
    }
    const validation = validateSectionItemsForWrite(section.kind, body.items);
    if (!validation.ok) return NextResponse.json({ error: validation.error ?? "Invalid items" }, { status: 400 });
    data.items = validation.items as unknown as Prisma.InputJsonValue;
  }

  if (body.order !== undefined) {
    if (typeof body.order !== "number" || !Number.isFinite(body.order)) {
      return NextResponse.json({ error: "order must be a number" }, { status: 400 });
    }
    data.order = body.order;
  }

  if (Object.keys(data).length <= 1) {
    return NextResponse.json({ error: "title, items, or order is required" }, { status: 400 });
  }

  const updated = await prisma.meetingOverviewSection.update({ where: { id: section.id }, data });
  return NextResponse.json(serializeOverviewSection(updated));
}

/** DELETE /api/meeting/[meetingId]/sections/[sectionId] — owner-only. Does
 *  not renumber the remaining sections' `order` (gaps are fine — the UI
 *  always sorts by `order`, it never assumes contiguity). */
export async function DELETE(req: NextRequest, { params }: { params: { meetingId: string; sectionId: string } }) {
  const auth = await requireMeetingEditor(req, params.meetingId);
  if (!auth.ok) return auth.response;

  const section = await loadOwnedSection(auth.summary.id, params.sectionId);
  if (!section) return NextResponse.json({ error: "Section not found" }, { status: 404 });

  await prisma.meetingOverviewSection.delete({ where: { id: section.id } });
  return NextResponse.json({ ok: true });
}
