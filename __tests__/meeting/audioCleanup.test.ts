import { describe, expect, it } from "vitest";
import { shouldPruneMeetingAudioEntry } from "../../lib/meeting/audio/cleanupMeetingAudio";

describe("Meeting audio cleanup", () => {
  it("keeps the merged file and any continuous full recording", () => {
    expect(shouldPruneMeetingAudioEntry("merged.m4a")).toBe(false);
    expect(shouldPruneMeetingAudioEntry("full.webm")).toBe(false);
    expect(shouldPruneMeetingAudioEntry("full.m4a")).toBe(false);
  });

  it("prunes numbered chunks and temporary uploads", () => {
    expect(shouldPruneMeetingAudioEntry("0.webm")).toBe(true);
    expect(shouldPruneMeetingAudioEntry("42.ogg")).toBe(true);
    expect(shouldPruneMeetingAudioEntry(".0.deadbeef.uploading")).toBe(true);
  });

  it("works on directory entry names without depending on path separators", () => {
    // readdir() returns names, not joined paths. This protects Windows where
    // path.join() uses backslashes and a split("/") check would be incorrect.
    expect(shouldPruneMeetingAudioEntry("full.wav", "merged.m4a")).toBe(false);
  });
});
