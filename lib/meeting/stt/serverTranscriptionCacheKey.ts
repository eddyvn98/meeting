import { createHash } from "node:crypto";

interface ServerTranscriptionCacheKeyInput {
  meetingId: string;
  sampleRate: number;
  sttLanguage: string;
  pcmBuffer: ArrayBuffer;
}

/**
 * The server STT endpoint is called twice with the same PCM when STT and
 * diarization are requested independently. De-duplicate only byte-for-byte
 * identical audio under the same decoding parameters; equal-sized audio is
 * not sufficient identity.
 */
export function serverTranscriptionCacheKey({
  meetingId,
  sampleRate,
  sttLanguage,
  pcmBuffer,
}: ServerTranscriptionCacheKeyInput): string {
  const digest = createHash("sha256")
    .update(Buffer.from(pcmBuffer))
    .digest("hex");
  return `${meetingId}:${sampleRate}:${sttLanguage}:${digest}`;
}
