import { createHash } from "node:crypto";

export function serverTranscriptionCacheKey(input: {
  meetingId: string;
  pcmBuffer: ArrayBuffer;
  sampleRate: number;
  sttLanguage: string;
}): string {
  const hash = createHash("sha256")
    .update(Buffer.from(input.pcmBuffer))
    .digest("hex");
  return [
    input.meetingId,
    String(input.sampleRate),
    input.sttLanguage.trim().toLowerCase(),
    hash,
  ].join(":");
}
