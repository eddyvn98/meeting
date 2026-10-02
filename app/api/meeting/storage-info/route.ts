import { NextRequest, NextResponse } from "next/server";
import { resolveMeetingCallerEmail } from "../_auth";
import { getStorageInfo } from "@/lib/meeting/audio/cleanupMeetingAudio";

/**
 * GET /api/meeting/storage-info — where recorded audio lives on disk and
 * how long it's kept before the scheduled cleanup sweep removes it (see
 * lib/meeting/audio/cleanupMeetingAudio.ts). `retentionDays` powers the
 * client-side audio-expiry warning (lib/meeting/audioRetention.ts,
 * useAudioRetentionDays.ts) shown in the sidebar and on the result page;
 * `path`/`totalBytes` are informational only, for whoever is running this
 * app locally.
 */
export async function GET(req: NextRequest) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(await getStorageInfo());
}
