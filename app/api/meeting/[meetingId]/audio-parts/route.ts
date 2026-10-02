import { NextRequest, NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { resolveMeetingAccess } from "../../_access";
import { mergedAudioPath } from "@/lib/meeting/audio/paths";

export const runtime = "nodejs";

/** GET /api/meeting/[meetingId]/audio-parts — what can be downloaded:
 *  whether the merged recording exists, and each stored part that is still on
 *  disk (download one with `/audio?part=N`). When the server could not merge
 *  the parts, they are the only copy of the recording. */
export async function GET(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  const role = meeting ? await resolveMeetingAccess(meeting, email) : null;
  if (!meeting || !role) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [chunks, hasMerged] = await Promise.all([
    prisma.audioChunk.findMany({ where: { meetingId: meeting.id }, orderBy: { sequence: "asc" } }),
    stat(mergedAudioPath(meeting.id)).then(() => true, () => false),
  ]);
  const parts = (
    await Promise.all(
      chunks.map(async (chunk) => {
        const fileStat = chunk.storageUrl ? await stat(chunk.storageUrl).catch(() => null) : null;
        return fileStat ? { sequence: chunk.sequence, sizeBytes: fileStat.size, durationSec: chunk.durationSec } : null;
      }),
    )
  ).filter((part): part is { sequence: number; sizeBytes: number; durationSec: number | null } => part !== null);
  return NextResponse.json({ merged: hasMerged, parts });
}
