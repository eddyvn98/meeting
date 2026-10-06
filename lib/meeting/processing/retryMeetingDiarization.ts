"use client";

import type { TranscriptSegment } from "@/lib/meeting/types";
import { decodeAudioTo16kMono } from "@/lib/meeting/stt/audioDecode";
import { runChunkedServerDiarization } from "@/lib/meeting/stt/chunkedServerDiarization";
import { assignSpeakerIndexes } from "@/lib/meeting/stt/diarization/mergeSpeakers";
import { mergeUtterances } from "@/lib/meeting/stt/mergeUtterances";

async function markStatus(
  meetingId: string,
  status: "RUNNING" | "DONE" | "FAILED",
  error?: string,
): Promise<void> {
  await fetch(`/api/meeting/${encodeURIComponent(meetingId)}/postprocess-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task: "diarization", status, error }),
  }).catch(() => undefined);
}

/**
 * Re-runs speaker enrichment only. Existing transcript text is reused, so a
 * crashed browser can recover diarization without paying the STT cost again.
 */
export async function retryMeetingDiarization(
  meetingId: string,
  segments: TranscriptSegment[],
): Promise<void> {
  await markStatus(meetingId, "RUNNING");
  try {
    const audioResponse = await fetch(
      `/api/meeting/${encodeURIComponent(meetingId)}/audio`,
      { cache: "no-store" },
    );
    if (!audioResponse.ok) {
      throw new Error(`Could not download meeting audio (${audioResponse.status}).`);
    }
    const blob = await audioResponse.blob();
    const { audio, sampleRate } = await decodeAudioTo16kMono(blob);
    if (audio.length === 0) throw new Error("Meeting audio could not be decoded.");

    const { spans, centroids } = await runChunkedServerDiarization(
      meetingId,
      audio,
      sampleRate,
    );

    const source = segments
      .map((segment) => ({
        start: segment.startTimeMs / 1000,
        end: segment.endTimeMs / 1000,
        text: segment.textEn ?? segment.textVi ?? "",
      }))
      .filter((segment) => segment.text.trim().length > 0);
    if (source.length === 0) throw new Error("Meeting transcript is empty.");

    const speakerIndexes = assignSpeakerIndexes(
      source.map((segment) => ({ start: segment.start, end: segment.end })),
      spans.map((span) => ({
        start: span.startTime,
        end: span.startTime + span.duration,
        speakerIndex: span.speakerIndex,
      })),
    );
    const tagged = source.map((segment, index) => ({
      ...segment,
      speakerIndex: speakerIndexes[index],
    }));
    const utterances = mergeUtterances(tagged);
    if (utterances.length === 0) {
      throw new Error("Speaker enrichment produced no transcript utterances.");
    }

    const response = await fetch(
      `/api/meeting/${encodeURIComponent(meetingId)}/transcript`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: utterances,
          isDiarizationUpdate: true,
          speakerCentroids: centroids.map((centroid) => ({
            speakerIndex: centroid.speakerIndex,
            embedding: Array.from(centroid.embedding),
            recognizedName: centroid.recognizedName,
          })),
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Could not save speaker-enriched transcript (${response.status}).`);
    }

    await markStatus(meetingId, "DONE");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await markStatus(meetingId, "FAILED", reason);
    throw error;
  }
}
