import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../_auth";

/** GET /api/meeting/glossary — the caller's personal glossary (domain
 *  jargon/names/acronyms), used across every meeting they process or
 *  translate — see lib/meeting/glossary/applyGlossary.ts. */
export async function GET(req: NextRequest) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const terms = await prisma.meetingGlossaryTerm.findMany({
    where: { ownerEmail: email },
    orderBy: { term: "asc" },
  });
  return NextResponse.json(
    terms.map((t) => ({ id: t.id, term: t.term, note: t.note, createdAt: t.createdAt.toISOString() })),
  );
}

/** POST /api/meeting/glossary — add a term (upsert on (ownerEmail, term):
 *  re-adding an existing term just updates its note). */
export async function POST(req: NextRequest) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { term?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const term = typeof body.term === "string" ? body.term.trim() : "";
  if (!term) return NextResponse.json({ error: "term is required" }, { status: 400 });
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

  const saved = await prisma.meetingGlossaryTerm.upsert({
    where: { ownerEmail_term: { ownerEmail: email, term } },
    create: { ownerEmail: email, term, note },
    update: { note },
  });
  return NextResponse.json({ id: saved.id, term: saved.term, note: saved.note, createdAt: saved.createdAt.toISOString() }, { status: 201 });
}
