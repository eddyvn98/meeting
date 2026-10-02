import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";

/** DELETE /api/meeting/glossary/[termId] — owner-only (of the term itself). */
export async function DELETE(req: NextRequest, { params }: { params: { termId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const term = await prisma.meetingGlossaryTerm.findUnique({ where: { id: params.termId } });
  if (!term || term.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.meetingGlossaryTerm.delete({ where: { id: params.termId } });
  return NextResponse.json({ ok: true });
}
