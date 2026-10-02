/**
 * lib/meeting/processing/applyMockComplete.ts
 *
 * Shared body of the guaranteed-completion fallback, factored out of
 * app/api/meeting/[meetingId]/mock-complete/route.ts so the same write path
 * can also be driven server-side by the claim route's stale-PROCESSING
 * recovery sweep (app/api/meeting/bot-sessions/claim/route.ts) without an
 * internal HTTP round trip. Writes a clearly-labeled MOCK transcript/summary
 * so a meeting that will never finish real STT (tab closed, model never
 * loaded, runner-side timeout, etc.) still reaches a terminal, retryable
 * state instead of sitting in PROCESSING forever. See mock-complete/route.ts
 * for the full rationale.
 */

import { prisma } from "@/lib/prisma";
import type { Meeting } from "@prisma/client";

/**
 * Applies the mock-complete write path to a meeting that is not already
 * READY. Idempotent: a meeting already READY is returned unchanged. Caller
 * is responsible for ownership/auth checks and for loading `meeting` first.
 */
export async function applyMockComplete(meeting: Meeting): Promise<Meeting> {
  if (meeting.status === "READY") return meeting;

  try {
    const speaker = await prisma.speaker.upsert({
      where: { meetingId_speakerKey: { meetingId: meeting.id, speakerKey: "speaker_1" } },
      create: { meetingId: meeting.id, speakerKey: "speaker_1" },
      update: {},
    });

    const segment = await prisma.transcriptSegment.create({
      data: {
        meetingId: meeting.id,
        speakerKey: speaker.speakerKey,
        order: 0,
        startTimeMs: 0,
        endTimeMs: Math.min(2400, (meeting.durationSec ?? 2) * 1000),
        textEn: "(mock) Local transcription wasn't available for this meeting — this is a placeholder transcript so the result screen has real data to render.",
        textVi: null,
      },
    });

    const summary = await prisma.meetingSummary.upsert({
      where: { meetingId: meeting.id },
      create: {
        meetingId: meeting.id,
        overview:
          "(mock) Automatic summary is not available for this meeting — real transcription didn't run. Use the Retry button above to try again.",
      },
      update: {},
    });

    await prisma.actionItem.upsert({
      where: { id: `${summary.id}-mock-action-0` },
      create: {
        id: `${summary.id}-mock-action-0`,
        summaryId: summary.id,
        task: "(mock) Use the Retry button above to run real transcription.",
        evidenceSegmentIds: [segment.id],
      },
      update: {},
    });

    return await prisma.meeting.update({
      where: { id: meeting.id },
      data: { status: "READY", failureReason: null, isMockResult: true },
    });
  } catch (err) {
    return await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        status: "FAILED",
        failureReason: err instanceof Error ? err.message : "Failed to process the recording.",
      },
    });
  }
}
