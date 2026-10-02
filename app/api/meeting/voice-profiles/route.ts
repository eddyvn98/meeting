import { NextRequest, NextResponse } from "next/server";
import { resolveMeetingCallerEmail } from "../_auth";
import { deleteVoiceProfile, listVoiceProfiles, loadVoiceProfileSeeds } from "@/lib/meeting/stt/voiceLibrary";

/**
 * GET /api/meeting/voice-profiles
 *
 * Company-wide voice library (see lib/meeting/stt/voiceLibrary.ts). Two
 * shapes depending on the caller:
 *  - Default: the LOCAL (client-side WASM/WebGPU, in a Worker) transcription
 *    path's diarization seeds — chunkedLocalTranscription.ts fetches this
 *    once per meeting before clustering, since the browser can't query
 *    Prisma directly the way transcribe-chunk/route.ts (the server tier)
 *    does. Returns {displayName, embedding}[].
 *  - `?summary=1`: the Speakers panel's "Voice directory" management view —
 *    {displayName, sampleCount, updatedAt}[], no embeddings (the UI never
 *    needs them and they're large enough to be wasteful to ship).
 * Any authenticated caller can read/manage the whole library (it's shared
 * company-wide, not per-owner) — see prisma/schema.prisma's
 * MeetingVoiceProfile doc comment for why this is deliberately not scoped
 * like the personal glossary.
 */
export async function GET(req: NextRequest) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (req.nextUrl.searchParams.has("summary")) {
    return NextResponse.json(await listVoiceProfiles());
  }

  const profiles = await loadVoiceProfileSeeds();
  return NextResponse.json(
    profiles.map((p) => ({ displayName: p.displayName, embedding: Array.from(p.embedding) })),
  );
}

/** DELETE /api/meeting/voice-profiles?displayName=John — removes one
 *  enrolled voice from the directory (e.g. it was enrolled under the wrong
 *  name). Does not touch any meeting's existing SpeakerMapping rows. */
export async function DELETE(req: NextRequest) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const displayName = req.nextUrl.searchParams.get("displayName");
  if (!displayName) return NextResponse.json({ error: "displayName is required" }, { status: 400 });

  await deleteVoiceProfile(displayName);
  return NextResponse.json({ ok: true });
}
