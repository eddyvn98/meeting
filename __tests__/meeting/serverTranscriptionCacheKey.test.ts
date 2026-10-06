import { describe, expect, it } from "vitest";
import { serverTranscriptionCacheKey } from "../../lib/meeting/stt/serverTranscriptionCacheKey";

function pcm(values: number[]): ArrayBuffer {
  return new Int16Array(values).buffer;
}

describe("server transcription cache key", () => {
  it("distinguishes different same-sized audio chunks", () => {
    const common = {
      meetingId: "meeting-a",
      sampleRate: 16000,
      sttLanguage: "en",
    };
    const first = serverTranscriptionCacheKey({ ...common, pcmBuffer: pcm([1, 2, 3, 4]) });
    const second = serverTranscriptionCacheKey({ ...common, pcmBuffer: pcm([4, 3, 2, 1]) });
    expect(first).not.toBe(second);
  });

  it("deduplicates identical audio for STT and diarization requests", () => {
    const input = {
      meetingId: "meeting-a",
      pcmBuffer: pcm([1, 2, 3, 4]),
      sampleRate: 16000,
      sttLanguage: "vi",
    };
    expect(serverTranscriptionCacheKey(input)).toBe(serverTranscriptionCacheKey(input));
  });

  it("separates sample rates and languages", () => {
    const base = {
      meetingId: "meeting-a",
      pcmBuffer: pcm([1, 2, 3, 4]),
      sampleRate: 16000,
      sttLanguage: "en",
    };
    expect(serverTranscriptionCacheKey(base)).not.toBe(
      serverTranscriptionCacheKey({ ...base, sampleRate: 48000 }),
    );
    expect(serverTranscriptionCacheKey(base)).not.toBe(
      serverTranscriptionCacheKey({ ...base, sttLanguage: "vi" }),
    );
  });
});
