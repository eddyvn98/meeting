import type { Prisma } from "@prisma/client";
import {
  buildEvidenceIdRemap,
  remapEvidenceInJson,
  type PersistedEvidenceSegment,
} from "./evidenceAlignment";

/**
 * Re-points every Overview evidence reference after the diarization pass
 * replaces the initial text-only transcript rows with merged speaker-aware
 * rows. This is intentionally inside the same DB transaction as transcript
 * replacement so callers never observe a half-remapped Overview.
 */
export async function remapSummaryEvidenceAfterTranscriptReplace(
  tx: Prisma.TransactionClient,
  summaryId: string,
  previousSegments: PersistedEvidenceSegment[],
  currentSegments: PersistedEvidenceSegment[],
): Promise<void> {
  if (previousSegments.length === 0 || currentSegments.length === 0) return;
  const idMap = buildEvidenceIdRemap(previousSegments, currentSegments);

  const [topics, decisions, actionItems, blockers, openQuestions, sections] = await Promise.all([
    tx.topic.findMany({ where: { summaryId } }),
    tx.decision.findMany({ where: { summaryId } }),
    tx.actionItem.findMany({ where: { summaryId } }),
    tx.blocker.findMany({ where: { summaryId } }),
    tx.openQuestion.findMany({ where: { summaryId } }),
    tx.meetingOverviewSection.findMany({ where: { summaryId } }),
  ]);

  const remapIds = (ids: string[]) => ids.map((id) => idMap.get(id) ?? id);

  await Promise.all([
    ...topics.map((row) =>
      tx.topic.update({ where: { id: row.id }, data: { evidenceSegmentIds: remapIds(row.evidenceSegmentIds) } }),
    ),
    ...decisions.map((row) =>
      tx.decision.update({ where: { id: row.id }, data: { evidenceSegmentIds: remapIds(row.evidenceSegmentIds) } }),
    ),
    ...actionItems.map((row) =>
      tx.actionItem.update({ where: { id: row.id }, data: { evidenceSegmentIds: remapIds(row.evidenceSegmentIds) } }),
    ),
    ...blockers.map((row) =>
      tx.blocker.update({ where: { id: row.id }, data: { evidenceSegmentIds: remapIds(row.evidenceSegmentIds) } }),
    ),
    ...openQuestions.map((row) =>
      tx.openQuestion.update({ where: { id: row.id }, data: { evidenceSegmentIds: remapIds(row.evidenceSegmentIds) } }),
    ),
    ...sections.map((section) =>
      tx.meetingOverviewSection.update({
        where: { id: section.id },
        data: { items: remapEvidenceInJson(section.items, idMap) as Prisma.InputJsonValue },
      }),
    ),
  ]);
}
