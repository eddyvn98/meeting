import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { serializeMeeting } from "@/lib/meeting/serialize";
import { correctTranscriptText } from "@/lib/meeting/glossary/applyGlossary";
import { ensureMeetingEnrichment } from "@/lib/meeting/ai/ensureMeetingEnrichment";
import { remapSummaryEvidenceAfterTranscriptReplace } from "@/lib/meeting/ai/remapSummaryEvidence";
import { inferRosterSpeakerMappings, parseSpeakerObservations } from "@/lib/meeting/bot/rosterMapping";

interface IncomingSegment {
  start: number;
  end: number;
  text: string;
  /** 0-based stable speaker index from the diarization pipeline (see
   *  lib/meeting/stt/diarization/mergeSpeakers.ts). Absent/invalid values
   *  default to 0 — the pre-diarization single-implied-speaker behavior. */
  speakerIndex?: number;
}

/** One diarized speaker's final embedding centroid, keyed by the same
 *  speakerIndex the segments use — see runLocalMeetingProcessing.ts's
 *  saveTranscript. `recognizedName` is set when this speaker already
 *  matched a company-wide voice-library enrollment (speakerClustering.ts's
 *  seedProfiles), so the mapping below can be auto-created instead of
 *  staying `speaker_N` until someone renames it manually. */
interface IncomingSpeakerCentroid {
  speakerIndex: number;
  embedding: number[];
  recognizedName?: string;
}

function speakerKeyForIndex(index: number): string {
  return `speaker_${index + 1}`;
}

function speakerKeyFor(segment: IncomingSegment): string {
  const index = typeof segment.speakerIndex === "number" && segment.speakerIndex >= 0 ? segment.speakerIndex : 0;
  return speakerKeyForIndex(index);
}

/**
 * POST /api/meeting/[meetingId]/transcript
 *
 * Persists a REAL transcript from the Processing screen's local STT attempt
 * (lib/meeting/processing/runLocalMeetingProcessing.ts, running
 * lib/meeting/stt/localWhisperProvider.ts client-side) and marks the meeting
 * READY immediately after that — before either AI enrichment call below —
 * so the Processing screen's poll-and-redirect sees READY (and the user
 * lands on the transcript) as soon as transcription itself is done, instead
 * of waiting on two more sequential upstream LLM round-trips that can each
 * take tens of seconds on a full transcript. Replaces any existing
 * transcript/summary wholesale (delete + recreate) rather than upserting
 * per-row — this is also what lets it safely overwrite a
 * mock-complete/route.ts placeholder if local STT finishes after that
 * fallback already ran.
 *
 * As soon as the first durable STT text is saved, it asks the meeting agent
 * (difyMeetingAgent.ts generateMeetingInsights) for Summary + dynamic
 * Overview sections. This intentionally starts BEFORE diarization: those
 * artifacts need transcript text, not speaker embeddings. A later
 * diarization-only transcript replacement preserves the generated Overview
 * and remaps evidence ids to the final merged transcript rows.
 *
 * Vietnamese translation is intentionally NOT generated here — it's an
 * on-demand action now (POST /api/meeting/[meetingId]/translate, triggered
 * by a "Translate" button in the Transcript tab) rather than an automatic
 * background call for every meeting, so a meeting nobody ever looks at in
 * Vietnamese doesn't spend an upstream LLM call on it.
 *
 * Each segment's `speakerIndex` (from the diarization pipeline, see
 * runLocalMeetingProcessing.ts) maps to its own `speaker_${n}` Speaker row —
 * one Speaker row is upserted per distinct index seen, instead of always
 * hardcoding "speaker_1" (mock-complete/route.ts still does that, since its
 * placeholder transcript never went through real diarization). Each
 * Speaker's final diarization centroid (`speakerCentroids` in the body) is
 * stored on it too, and any speaker the pipeline already recognized from
 * the company-wide voice library gets its SpeakerMapping auto-created here
 * — see lib/meeting/stt/voiceLibrary.ts and speakerClustering.ts.
 */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  if (!meeting || meeting.ownerEmail.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: {
    segments?: IncomingSegment[];
    speakerCentroids?: IncomingSpeakerCentroid[];
    isPartial?: boolean;
    /** True only for the second pass that adds speaker labels after the
     *  text-only transcript was already saved and Overview generation began. */
    isDiarizationUpdate?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const segments = Array.isArray(body.segments) ? body.segments : [];
  const isDiarizationUpdate = body.isDiarizationUpdate === true;
  if (segments.length === 0) {
    return NextResponse.json({ error: "segments must be a non-empty array" }, { status: 400 });
  }
  const MAX_SEGMENTS = 20_000;
  const MAX_SEGMENT_TEXT_LENGTH = 5_000;
  if (segments.length > MAX_SEGMENTS) {
    return NextResponse.json({ error: "Too many segments" }, { status: 413 });
  }
  for (const s of segments) {
    if (
      typeof s.start !== "number" || !Number.isFinite(s.start) ||
      typeof s.end !== "number" || !Number.isFinite(s.end) ||
      typeof s.text !== "string" || s.text.length > MAX_SEGMENT_TEXT_LENGTH
    ) {
      return NextResponse.json({ error: "Invalid segment data" }, { status: 400 });
    }
  }
  const centroidsByKey = new Map(
    (Array.isArray(body.speakerCentroids) ? body.speakerCentroids : []).map((c) => [speakerKeyForIndex(c.speakerIndex), c]),
  );

  // Fuzzy-correct raw STT output against the caller's personal glossary
  // before anything is persisted — a mis-heard proper noun/acronym should
  // never make it into the saved transcript, the AI insights prompt, or the
  // Ask agent's context in the first place. See applyGlossary.ts.
  const glossary = await prisma.meetingGlossaryTerm.findMany({ where: { ownerEmail: email } });
  if (glossary.length > 0) {
    for (const s of segments) s.text = correctTranscriptText(s.text, glossary);
  }

  const speakerKeys = Array.from(new Set(segments.map(speakerKeyFor)));
  const recognized = [...centroidsByKey.entries()].filter(([, c]) => c.recognizedName);
  const lastEnd = Math.max(...segments.map((s) => s.end));

  // Transcript replacement and Overview evidence remapping are serialized
  // with Overview creation. This closes the race where Dify finishes at the
  // same moment the diarization pass swaps raw STT rows for merged rows.
  const updated = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`meeting-overview:${meeting.id}`}))`;

    const previousSegments = await tx.transcriptSegment.findMany({
      where: { meetingId: meeting.id },
      orderBy: { order: "asc" },
    });
    const existingSummary = isDiarizationUpdate
      ? await tx.meetingSummary.findUnique({ where: { meetingId: meeting.id } })
      : null;

    await tx.transcriptSegment.deleteMany({ where: { meetingId: meeting.id } });
    // A fresh text save invalidates any old Overview. The second,
    // diarization-only save must preserve the Overview that Dify may already
    // have generated from exactly the same text.
    if (!isDiarizationUpdate) {
      await tx.meetingSummary.deleteMany({ where: { meetingId: meeting.id } });
    }

    await Promise.all(
      speakerKeys.map((speakerKey) => {
        const embeddingJson = centroidsByKey.get(speakerKey)?.embedding;
        return tx.speaker.upsert({
          where: { meetingId_speakerKey: { meetingId: meeting.id, speakerKey } },
          create: { meetingId: meeting.id, speakerKey, embeddingJson },
          update: { embeddingJson },
        });
      }),
    );

    if (recognized.length > 0) {
      await Promise.all(
        recognized.map(([speakerKey, c]) =>
          tx.speakerMapping.upsert({
            where: { meetingId_speakerKey: { meetingId: meeting.id, speakerKey } },
            create: { meetingId: meeting.id, speakerKey, displayName: c.recognizedName!, updatedByEmail: email },
            update: { displayName: c.recognizedName!, updatedByEmail: email },
          }),
        ),
      );
    }

    await tx.transcriptSegment.createMany({
      data: segments.map((s, order) => ({
        meetingId: meeting.id,
        speakerKey: speakerKeyFor(s),
        order,
        startTimeMs: Math.round(s.start * 1000),
        endTimeMs: Math.round(s.end * 1000),
        textEn: s.text,
        textVi: null,
      })),
    });
    const savedSegments = await tx.transcriptSegment.findMany({
      where: { meetingId: meeting.id },
      orderBy: { order: "asc" },
    });

    if (isDiarizationUpdate) {
      const [botSession, existingMappings] = await Promise.all([
        tx.meetingBotSession.findUnique({
          where: { meetingId: meeting.id },
          select: { participantNames: true, speakerObservations: true },
        }),
        tx.speakerMapping.findMany({ where: { meetingId: meeting.id } }),
      ]);
      if (botSession) {
        const inferredMappings = inferRosterSpeakerMappings({
          segments: savedSegments.map((segment) => ({
            speakerKey: segment.speakerKey,
            startTimeMs: segment.startTimeMs,
            endTimeMs: segment.endTimeMs,
          })),
          participantNames: botSession.participantNames,
          observations: parseSpeakerObservations(botSession.speakerObservations),
          existingMappings,
        });
        if (inferredMappings.length > 0) {
          await Promise.all(
            inferredMappings.map((mapping) =>
              tx.speakerMapping.upsert({
                where: {
                  meetingId_speakerKey: {
                    meetingId: meeting.id,
                    speakerKey: mapping.speakerKey,
                  },
                },
                create: {
                  meetingId: meeting.id,
                  speakerKey: mapping.speakerKey,
                  displayName: mapping.displayName,
                  updatedByEmail: email,
                },
                update: {
                  displayName: mapping.displayName,
                  updatedByEmail: email,
                },
              }),
            ),
          );
        }
      }
    }

    if (isDiarizationUpdate && existingSummary) {
      await remapSummaryEvidenceAfterTranscriptReplace(
        tx,
        existingSummary.id,
        previousSegments,
        savedSegments,
      );
    }

    await tx.meeting.update({
      where: { id: meeting.id },
      data: {
        status: "READY",
        failureReason: null,
        isMockResult: false,
        durationSec: meeting.durationSec ?? Math.round(lastEnd),
        ...(isDiarizationUpdate
          ? {
              diarizationStatus: "DONE",
              diarizationError: null,
            }
          : {
              diarizationStatus: "PENDING",
              diarizationError: null,
              enrichmentStatus: "RUNNING",
              enrichmentError: null,
            }),
      },
    });

    return tx.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
  }, { maxWait: 10_000, timeout: 30_000 });

  // The first durable STT text is enough for Summary + Overview sections.
  // The job writes durable RUNNING/DONE/FAILED state so a later page load can
  // retry it after a server restart without re-running STT.
  if (!isDiarizationUpdate) {
    void ensureMeetingEnrichment(meeting.id, email).catch((err) => {
      console.warn(
        "[meeting] Background insights enrichment failed:",
        err instanceof Error ? err.message : String(err),
      );
    });
  }

  return NextResponse.json(serializeMeeting(updated));
}
