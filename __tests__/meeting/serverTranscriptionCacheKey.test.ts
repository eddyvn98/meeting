import { describe, expect, it } from "vitest";
import { serverTranscriptionCacheKey } from "../../lib/meeting/stt/serverTranscriptionCacheKey";

function key(bytes: number[], sampleRate = 16_000, sttLanguage = "en") {
  return serverTranscriptionCacheKey({
    meetingId: "meeting-1",
    sampleRate,
    sttLanguage,
    pcmBuffer: Uint8Array.from(bytes).buffer,
  });
}

describe("server transcription cache identity", () => {
  it("does not collide for equal-sized audio with different content", () => {
    expect(key([0, 1, 2, 3])).not.toBe(key([3, 2, 1, 0]));
  });

  it("deduplicates identical audio under identical decode parameters", () => {
    expect(key([10, 20, 30, 40])).toBe(key([10, 20, 30, 40]));
  });

  it("separates identical bytes decoded with different parameters", () => {
    expect(key([1, 2, 3, 4], 16_000, "en")).not.toBe(
      key([1, 2, 3, 4], 48_000, "en"),
    );
    expect(key([1, 2, 3, 4], 16_000, "en")).not.toBe(
      key([1, 2, 3, 4], 16_000, "vi"),
    );
  });
});
