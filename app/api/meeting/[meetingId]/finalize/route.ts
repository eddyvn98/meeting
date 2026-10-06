import { NextRequest, NextResponse } from "next/server";
import { rm, stat } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { serializeMeeting } from "@/lib/meeting/serialize";
import { mergeAudioChunks, splitReadableChunks } from "@/lib/meeting/audio/mergeAudioChunks";
import { findFullAudio, mergedAudioPath } from "@/lib/meeting/audio/paths";
import {
  acceptsAudio,
  finalizeLeaseStartedAt,
  FINALIZE_FAILURE_PREFIX,
  FINALIZING_PREFIX,
  isFinalizeInProgress,
  isRetryableFinalizeFailure,
} from "@/lib/meeting/audio/finalizeRetry";
import { pruneRawChunksAfterMerge } from "@/lib/meeting/audio/cleanupMeetingAudio";

const DEFAULT_FINALIZE_LEASE_MS = 20 * 60_000;

function finalizeLeaseMs(): number {
  const configured = Number(process.env.MEETING_FINALIZE_LEASE_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_FINALIZE_LEASE_MS;
}

/**
 * Finalization uses a short database transaction only to claim a per-meeting
 * finalize lease and freeze new uploads. Slow filesystem/ffmpeg work then runs
 * outside the transaction. This avoids holding a database connection and
 * advisory transaction lock for multi-minute recordings.
 */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { expectedChunkCount?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body remains valid for one-file uploads and recovery retries.
  }
  const requestedExpected =
    typeof body.expectedChunkCount === "number"
      ? Math.trunc(body.expectedChunkCount)
      : undefined;
  if (requestedExpected !== undefined && (requestedExpected < 1 || requestedExpected > 100_000)) {
    return NextResponse.json(
      { error: "expectedChunkCount must be a positive integer" },
      { status: 400 },
    );
  }

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const leaseReason = `${FINALIZING_PREFIX}${new Date().toISOString()}`;
  let skippedParts = 0;

  try {
    const claim = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`meeting-audio:${meeting.id}`}))`;
      const lockedMeeting = await tx.meeting.findUnique({ where: { id: meeting.id } });
      if (!lockedMeeting) throw new Error("Meeting not found");

      if (lockedMeeting.status === "READY" || lockedMeeting.status === "PROCESSING") {
        return { kind: "already-finalized" as const, meeting: lockedMeeting };
      }

      if (isFinalizeInProgress(lockedMeeting)) {
        const startedAt = finalizeLeaseStartedAt(lockedMeeting);
        const stale =
          startedAt === null || Date.now() - startedAt >= finalizeLeaseMs();
        if (!stale) {
          return { kind: "in-progress" as const, meeting: lockedMeeting };
        }
      } else if (!acceptsAudio(lockedMeeting)) {
        return { kind: "already-finalized" as const, meeting: lockedMeeting };
      }

      const chunks = await tx.audioChunk.findMany({
        where: { meetingId: lockedMeeting.id },
        orderBy: { sequence: "asc" },
      });

      const expectedChunkCount =
        requestedExpected ??
        (chunks.length === 1 || isRetryableFinalizeFailure(lockedMeeting)
          ? chunks.length || undefined
          : undefined);
      const missingSequences = expectedChunkCount
        ? Array.from({ length: expectedChunkCount }, (_, sequence) => sequence).filter(
            (sequence) =>
              chunks.find((chunk) => chunk.sequence === sequence)?.status !== "UPLOADED",
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
          missingSequences: chunks
            .filter((chunk) => !chunk.storageUrl)
            .map((chunk) => chunk.sequence),
        };
      }

      const claimed = await tx.meeting.update({
        where: { id: lockedMeeting.id },
        data: {
          status: "UPLOADING",
          failureReason: leaseReason,
        },
      });

      return {
        kind: "claimed" as const,
        meeting: claimed,
        chunks,
        orderedPaths: orderedPaths as string[],
      };
    }, { maxWait: 15_000, timeout: 30_000 });

    if (claim.kind === "in-progress") {
      return NextResponse.json(
        { error: "Recording finalization is already in progress", code: "FINALIZE_IN_PROGRESS" },
        { status: 409 },
      );
    }

    if (claim.kind === "incomplete") {
      return NextResponse.json(
        {
          error: "Waiting for all audio chunks",
          code: "WAITING_FOR_CHUNKS",
          expectedChunkCount: claim.expectedChunkCount,
          receivedChunkCount: claim.receivedChunkCount,
          missingSequences: claim.missingSequences,
        },
        { status: 409 },
      );
    }

    if (claim.kind === "already-finalized") {
      return NextResponse.json({ ...serializeMeeting(claim.meeting), skippedParts });
    }

    const chunks = claim.chunks;
    const orderedPaths = claim.orderedPaths;
    let merged = false;
    let usedFull = false;

    const fullPath = await findFullAudio(meeting.id);
    if (fullPath && (await splitReadableChunks([fullPath])).readable.length === 1) {
      const encoded = await mergeAudioChunks(
        [fullPath],
        mergedAudioPath(meeting.id),
        { allowSingle: true },
      );
      if (!encoded.success) {
        console.warn(
          "[meeting] finalize: could not re-encode the continuous recording, serving it as uploaded:",
          encoded.error,
        );
      }
      merged = encoded.success;
      usedFull = true;
    } else {
      const missingFiles = (
        await Promise.all(orderedPaths.map((path) => stat(path).catch(() => null)))
      )
        .map((fileStat, index) => (fileStat ? null : chunks[index].sequence))
        .filter((sequence): sequence is number => sequence !== null);
      if (missingFiles.length > 0) {
        throw new Error(`Audio files disappeared before finalization: ${missingFiles.join(", ")}`);
      }

      if (chunks.length > 1) {
        const split = await splitReadableChunks(orderedPaths);
        if (split.unreadable.length > 0) {
          console.warn(
            `[meeting] finalize ${meeting.id}: skipping ${split.unreadable.length} unreadable audio part(s):`,
            split.unreadable,
          );
          skippedParts = split.unreadable.length;
        }
        if (split.readable.length === 0) {
          throw new Error(
            "None of the audio parts could be read. They are kept so they can be downloaded.",
          );
        }
        const mergedResult = await mergeAudioChunks(
          split.readable,
          mergedAudioPath(meeting.id),
          { allowSingle: true },
        );
        if (!mergedResult.success) {
          throw new Error(`Failed to merge all audio chunks safely: ${mergedResult.error}`);
        }
        merged = true;
      }
    }

    const summedDurationSec = chunks.reduce(
      (sum, chunk) => sum + (chunk.durationSec ?? 0),
      0,
    );
    const durationSec =
      claim.meeting.durationSec ?? (summedDurationSec > 0 ? summedDurationSec : null);

    const committed = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`meeting-audio:${meeting.id}`}))`;
      const updated = await tx.meeting.updateMany({
        where: {
          id: meeting.id,
          status: "UPLOADING",
          failureReason: leaseReason,
        },
        data: {
          status: "PROCESSING",
          durationSec,
          failureReason: null,
          audioUrl: `/api/meeting/${meeting.id}/audio`,
        },
      });
      if (updated.count !== 1) {
        throw new Error("Finalize lease was lost before the recording could be committed.");
      }
      const fresh = await tx.meeting.findUnique({ where: { id: meeting.id } });
      if (!fresh) throw new Error("Meeting not found after finalization.");
      return fresh;
    }, { maxWait: 15_000, timeout: 30_000 });

    if (merged) await pruneRawChunksAfterMerge(meeting.id);
    if (!usedFull) {
      const unusable = await findFullAudio(meeting.id);
      if (unusable) await rm(unusable, { force: true });
    }

    return NextResponse.json({ ...serializeMeeting(committed), skippedParts });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Failed to prepare the recording.";
    console.warn("[meeting] finalize failed, meeting stays retryable:", reason);
    await prisma.meeting.updateMany({
      where: {
        id: meeting.id,
        status: "UPLOADING",
        failureReason: leaseReason,
      },
      data: {
        status: "FAILED",
        failureReason: `${FINALIZE_FAILURE_PREFIX}${reason}`,
      },
    }).catch(() => undefined);
    return NextResponse.json(
      {
        error: "The recording could not be finalized yet. Your audio is saved; try again.",
        code: "FINALIZE_RETRYABLE",
        detail: reason,
      },
      { status: 500 },
    );
  }
}
