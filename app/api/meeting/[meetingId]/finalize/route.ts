import { NextRequest, NextResponse } from "next/server";
import { rm, stat } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { serializeMeeting } from "@/lib/meeting/serialize";
import { mergeAudioChunks, splitReadableChunks } from "@/lib/meeting/audio/mergeAudioChunks";
import { findFullAudio, mergedAudioPath } from "@/lib/meeting/audio/paths";
import { acceptsAudio, isRetryableFinalizeFailure, FINALIZE_FAILURE_PREFIX } from "@/lib/meeting/audio/finalizeRetry";
import { pruneRawChunksAfterMerge } from "@/lib/meeting/audio/cleanupMeetingAudio";

/** Finalize only after every declared chunk and backing file is present. */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { expectedChunkCount?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body remains valid for the one-file upload flow.
  }
  const requestedExpected = typeof body.expectedChunkCount === "number" ? Math.trunc(body.expectedChunkCount) : undefined;
  if (requestedExpected !== undefined && (requestedExpected < 1 || requestedExpected > 100_000)) {
    return NextResponse.json({ error: "expectedChunkCount must be a positive integer" }, { status: 400 });
  }

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let skippedParts = 0;
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Cross-instance lock: uploads and finalize for one meeting are serialized.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`meeting-audio:${meeting.id}`}))`;
      const lockedMeeting = await tx.meeting.findUnique({ where: { id: meeting.id } });
      if (!lockedMeeting) throw new Error("Meeting not found");

      if (lockedMeeting.status === "READY" || lockedMeeting.status === "PROCESSING") {
        return { kind: "already-finalized" as const, meeting: lockedMeeting };
      }
      if (!acceptsAudio(lockedMeeting)) {
        return { kind: "already-finalized" as const, meeting: lockedMeeting };
      }

      const chunks = await tx.audioChunk.findMany({
        where: { meetingId: lockedMeeting.id },
        orderBy: { sequence: "asc" },
      });

      // The continuous recording uploaded at End Meeting, when readable, IS the
      // recording: no joins, so no dropouts, and no dependence on every chunk
      // having arrived. An unreadable or missing one falls back to the chunks.
      const fullPath = await findFullAudio(lockedMeeting.id);
      if (fullPath && (await splitReadableChunks([fullPath])).readable.length === 1) {
        // Re-encode to the standard file; if that fails, the original is served as is.
        const encoded = await mergeAudioChunks([fullPath], mergedAudioPath(lockedMeeting.id), { allowSingle: true });
        if (!encoded.success) console.warn("[meeting] finalize: could not re-encode the continuous recording, serving it as uploaded:", encoded.error);
        const summedSec = chunks.reduce((sum, chunk) => sum + (chunk.durationSec ?? 0), 0);
        const updated = await tx.meeting.update({
          where: { id: lockedMeeting.id },
          data: {
            status: "PROCESSING",
            durationSec: lockedMeeting.durationSec ?? (summedSec > 0 ? summedSec : null),
            failureReason: null,
            audioUrl: `/api/meeting/${lockedMeeting.id}/audio`,
          },
        });
        // The chunks are redundant once the continuous file is encoded; keep them if it was not.
        return { kind: "started" as const, meeting: updated, merged: encoded.success, usedFull: true };
      }
      // The old whole-file upload has exactly one chunk; live recordings must
      // send the explicit count so a partial recording cannot be finalized.
      // A retry of a failed finalize has no browser count to send (it may come
      // from another device): the chunks already stored are the recording, and
      // the contiguity check below still rejects a gap.
      const expectedChunkCount = requestedExpected ?? (chunks.length === 1 || isRetryableFinalizeFailure(lockedMeeting) ? chunks.length || undefined : undefined);
      const missingSequences = expectedChunkCount
        ? Array.from({ length: expectedChunkCount }, (_, sequence) => sequence).filter(
            (sequence) => chunks.find((chunk) => chunk.sequence === sequence)?.status !== "UPLOADED",
          )
        : [];

      if (!expectedChunkCount || chunks.length !== expectedChunkCount || missingSequences.length > 0) {
        return {
          kind: "incomplete" as const,
          meeting: lockedMeeting,
          expectedChunkCount: expectedChunkCount ?? null,
          receivedChunkCount: chunks.length,
          missingSequences,
        };
      }

      const orderedPaths = chunks.map((chunk) => chunk.storageUrl);
      if (orderedPaths.some((path) => !path)) {
        return {
          kind: "incomplete" as const,
          meeting: lockedMeeting,
          expectedChunkCount,
          receivedChunkCount: chunks.length,
          missingSequences: chunks.filter((chunk) => !chunk.storageUrl).map((chunk) => chunk.sequence),
        };
      }

      const missingFiles = (await Promise.all(orderedPaths.map((path) => stat(path!).catch(() => null))))
        .map((fileStat, index) => (fileStat ? null : chunks[index].sequence))
        .filter((sequence): sequence is number => sequence !== null);
      if (missingFiles.length > 0) {
        return {
          kind: "incomplete" as const,
          meeting: lockedMeeting,
          expectedChunkCount,
          receivedChunkCount: chunks.length,
          missingSequences: missingFiles,
        };
      }

      const summedDurationSec = chunks.reduce((sum, chunk) => sum + (chunk.durationSec ?? 0), 0);
      const durationSec = lockedMeeting.durationSec ?? (summedDurationSec > 0 ? summedDurationSec : null);

      if (chunks.length > 1) {
        // One unreadable part would fail the whole merge. Merge the readable
        // ones instead, so a damaged part costs seconds of audio, not the meeting.
        const split = await splitReadableChunks(orderedPaths as string[]);
        if (split.unreadable.length > 0) {
          console.warn(`[meeting] finalize ${lockedMeeting.id}: skipping ${split.unreadable.length} unreadable audio part(s):`, split.unreadable);
          skippedParts = split.unreadable.length;
        }
        if (split.readable.length === 0) throw new Error("None of the audio parts could be read. They are kept so they can be downloaded.");
        const merged = await mergeAudioChunks(split.readable, mergedAudioPath(lockedMeeting.id), { allowSingle: true });
        if (!merged.success) throw new Error(`Failed to merge all audio chunks safely: ${merged.error}`);
      }

      const updated = await tx.meeting.update({
        where: { id: lockedMeeting.id },
        data: {
          status: "PROCESSING",
          durationSec,
          failureReason: null,
          audioUrl: `/api/meeting/${lockedMeeting.id}/audio`,
        },
      });
      return { kind: "started" as const, meeting: updated, merged: chunks.length > 1, usedFull: false };
    }, { maxWait: 15_000, timeout: 10 * 60 * 1000 });

    if (result.kind === "incomplete") {
      return NextResponse.json(
        {
          error: "Waiting for all audio chunks",
          code: "WAITING_FOR_CHUNKS",
          expectedChunkCount: result.expectedChunkCount,
          receivedChunkCount: result.receivedChunkCount,
          missingSequences: result.missingSequences,
        },
        { status: 409 },
      );
    }
    // The raw chunks are only redundant once the merged file AND the status
    // change are committed. Pruning inside the transaction could delete them
    // and then lose the commit, leaving a meeting with no usable audio.
    if (result.kind === "started" && result.merged) await pruneRawChunksAfterMerge(meeting.id);
    // A continuous recording that could not be read was passed over for the chunks: drop it.
    if (result.kind === "started" && !result.usedFull) {
      const unusable = await findFullAudio(meeting.id);
      if (unusable) await rm(unusable, { force: true });
    }
    return NextResponse.json({ ...serializeMeeting(result.meeting), skippedParts });
  } catch (err) {
    // Marked FAILED so the failure is visible, but tagged as retryable: every
    // chunk is still on disk and in the browser, so the same call can simply be
    // repeated (see lib/meeting/audio/finalizeRetry.ts). The tag keeps the
    // audio from being swept and the local backup from being discarded.
    const reason = err instanceof Error ? err.message : "Failed to prepare the recording.";
    console.warn("[meeting] finalize failed, meeting stays retryable:", reason);
    await prisma.meeting
      .update({ where: { id: meeting.id }, data: { status: "FAILED", failureReason: `${FINALIZE_FAILURE_PREFIX}${reason}` } })
      .catch(() => undefined);
    return NextResponse.json(
      { error: "The recording could not be finalized yet. Your audio is saved; try again.", code: "FINALIZE_RETRYABLE", detail: reason },
      { status: 500 },
    );
  }
}
