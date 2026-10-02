import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { serializeSpeakerMapping } from "@/lib/meeting/serialize";
import { enrollVoiceProfile } from "@/lib/meeting/stt/voiceLibrary";
import { UNKNOWN_SPEAKER_NAME, type UpdateSpeakerMappingInput } from "@/lib/meeting/types";

/** PUT /api/meeting/[meetingId]/speakers — renames a diarized speaker
 *  (`speaker_1` -> "John"). Upserts the SpeakerMapping row rather than
 *  touching Speaker or any TranscriptSegment, so a rename never rewrites
 *  transcript rows (see prisma/schema.prisma SpeakerMapping doc comment).
 *  Owner-only, same access rule as GET /api/meeting/[meetingId].
 *
 *  Also enrolls this speaker's diarization embedding (Speaker.embeddingJson,
 *  if this meeting's diarization actually produced one) into the
 *  company-wide voice library under the new name — see voiceLibrary.ts —
 *  so every future meeting anyone processes recognizes this same voice
 *  automatically instead of needing this rename repeated. Best-effort: a
 *  failure here never fails the rename itself. */
export async function PUT(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: Partial<UpdateSpeakerMappingInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.speakerKey !== "string" || !body.speakerKey.trim()) {
    return NextResponse.json({ error: "speakerKey is required" }, { status: 400 });
  }
  if (typeof body.displayName !== "string" || !body.displayName.trim()) {
    return NextResponse.json({ error: "displayName is required" }, { status: 400 });
  }

  const mapping = await prisma.speakerMapping.upsert({
    where: { meetingId_speakerKey: { meetingId: meeting.id, speakerKey: body.speakerKey } },
    create: {
      meetingId: meeting.id,
      speakerKey: body.speakerKey,
      displayName: body.displayName.trim(),
      updatedByEmail: email,
    },
    update: {
      displayName: body.displayName.trim(),
      updatedByEmail: email,
    },
  });

  try {
    if (mapping.displayName !== UNKNOWN_SPEAKER_NAME) {
      const speaker = await prisma.speaker.findUnique({
        where: { meetingId_speakerKey: { meetingId: meeting.id, speakerKey: body.speakerKey } },
      });
      const embedding = toFloat32(speaker?.embeddingJson);
      if (embedding) await enrollVoiceProfile(mapping.displayName, embedding);
    }
  } catch (err) {
    console.warn("[meeting] Failed to enroll voice profile (rename itself still succeeded):", err instanceof Error ? err.message : String(err));
  }

  return NextResponse.json(serializeSpeakerMapping(mapping));
}

function toFloat32(json: unknown): Float32Array | null {
  if (!Array.isArray(json) || json.some((v) => typeof v !== "number")) return null;
  return new Float32Array(json as number[]);
}
