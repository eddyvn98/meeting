import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireMeetingEditor } from "./_shared";
import { serializeOverviewSection } from "@/lib/meeting/serialize";
import { defaultTitleFor, isOverviewSectionKind, validateSectionItemsForWrite } from "@/lib/meeting/overviewSections";

/** POST /api/meeting/[meetingId]/sections — creates a new dynamic overview
 *  section, appended at the end of the meeting's section order (Overview
 *  tab's "Add section" menu, which lists the fixed kind library from
 *  overviewSections.ts with each kind's default title). Owner-only — see
 *  _shared.ts. Body: `{ kind, title?, items? }`; `title` defaults to the
 *  kind's default title, `items` defaults to `[]`. Always written with
 *  `source: "user"`. */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const auth = await requireMeetingEditor(req, params.meetingId);
  if (!auth.ok) return auth.response;

  let body: { kind?: unknown; title?: unknown; items?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isOverviewSectionKind(body.kind)) {
    return NextResponse.json({ error: "kind must be one of the known section kinds" }, { status: 400 });
  }
  const kind = body.kind;

  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : defaultTitleFor(kind);

  const itemsValidation = validateSectionItemsForWrite(kind, body.items ?? []);
  if (!itemsValidation.ok) {
    return NextResponse.json({ error: itemsValidation.error ?? "Invalid items" }, { status: 400 });
  }

  const last = await prisma.meetingOverviewSection.findFirst({
    where: { summaryId: auth.summary.id },
    orderBy: { order: "desc" },
  });
  const order = last ? last.order + 1 : 0;

  const created = await prisma.meetingOverviewSection.create({
    data: {
      summaryId: auth.summary.id,
      kind,
      title,
      order,
      source: "user",
      items: itemsValidation.items as unknown as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json(serializeOverviewSection(created), { status: 201 });
}
