import { prisma } from "@/lib/prisma";
import { generateMeetingInsights } from "./difyMeetingAgent";
import { buildSummaryCreateInput } from "./buildSummaryCreateInput";
import { alignEvidenceSegmentIds } from "./evidenceAlignment";

function isDefaultTitle(title: string): boolean {
  return /^Meeting - /.test(title);
}

/**
 * Generates the durable Meeting Overview from the currently saved transcript.
 *
 * The transcript itself is already usable before this runs. Status is stored
 * on Meeting so a browser/server restart can retry this job independently of
 * STT. The final write is serialized by meeting-overview:<id>, making repeated
 * recovery calls idempotent even if two attempts overlap.
 */
export async function ensureMeetingEnrichment(
  meetingId: string,
  callerEmail: string,
): Promise<void> {
  const [meeting, snapshot] = await Promise.all([
    prisma.meeting.findUnique({ where: { id: meetingId } }),
    prisma.transcriptSegment.findMany({
      where: { meetingId },
      orderBy: { order: "asc" },
    }),
  ]);
  if (!meeting) throw new Error("Meeting not found.");
  if (snapshot.length === 0) throw new Error("Meeting has no transcript to enrich.");

  const existing = await prisma.meetingSummary.findUnique({ where: { meetingId } });
  if (existing) {
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { enrichmentStatus: "DONE", enrichmentError: null },
    });
    return;
  }

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { enrichmentStatus: "RUNNING", enrichmentError: null },
  });

  const sourceSegments = snapshot.map((segment) => ({
    start: segment.startTimeMs / 1000,
    end: segment.endTimeMs / 1000,
    text: segment.textEn ?? segment.textVi ?? "",
    speaker: segment.speakerKey,
  }));

  try {
    const insights = await generateMeetingInsights({
      meetingTitle: meeting.title,
      transcript: sourceSegments.map((segment) => ({
        speaker: segment.speaker,
        text: segment.text,
      })),
      callerEmail,
    });
    const overview =
      insights?.overview ||
      sourceSegments.map((segment) => segment.text).join(" ").slice(0, 500);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`meeting-overview:${meetingId}`}))`;

      const alreadyCreated = await tx.meetingSummary.findUnique({ where: { meetingId } });
      if (!alreadyCreated) {
        const currentSegments = await tx.transcriptSegment.findMany({
          where: { meetingId },
          orderBy: { order: "asc" },
        });
        const alignedIds = alignEvidenceSegmentIds(sourceSegments, currentSegments);

        await tx.meetingSummary.create({
          data: buildSummaryCreateInput(meetingId, overview, insights, alignedIds),
        });

        if (insights?.suggestedTitle && isDefaultTitle(meeting.title)) {
          await tx.meeting.update({
            where: { id: meetingId },
            data: { title: insights.suggestedTitle },
          });
        }
      }

      await tx.meeting.update({
        where: { id: meetingId },
        data: { enrichmentStatus: "DONE", enrichmentError: null },
      });
    }, { maxWait: 10_000, timeout: 30_000 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await prisma.meeting.update({
      where: { id: meetingId },
      data: {
        enrichmentStatus: "FAILED",
        enrichmentError: reason.slice(0, 4000),
      },
    }).catch(() => undefined);
    throw error;
  }
}
