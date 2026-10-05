import { describe, expect, it } from "vitest";
import { inferRosterSpeakerMappings } from "../../lib/meeting/bot/rosterMapping";

const segments = [
  { speakerKey: "speaker_1", startTimeMs: 0, endTimeMs: 4500 },
  { speakerKey: "speaker_2", startTimeMs: 5000, endTimeMs: 9500 },
];

describe("Teams roster speaker mapping", () => {
  it("maps diarized speakers when active-speaker votes are clear", () => {
    const result = inferRosterSpeakerMappings({
      segments,
      participantNames: ["John Smith", "Mary Tran"],
      observations: [
        { atMs: 1000, names: ["John Smith"] },
        { atMs: 3000, names: ["John Smith"] },
        { atMs: 6000, names: ["Mary Tran"] },
        { atMs: 8000, names: ["Mary Tran"] },
      ],
    });
    expect(result.map((row) => [row.speakerKey, row.displayName])).toEqual([
      ["speaker_1", "John Smith"],
      ["speaker_2", "Mary Tran"],
    ]);
  });

  it("does not guess when votes are ambiguous", () => {
    const result = inferRosterSpeakerMappings({
      segments: [segments[0]],
      participantNames: ["John Smith", "Mary Tran"],
      observations: [
        { atMs: 1000, names: ["John Smith"] },
        { atMs: 2000, names: ["Mary Tran"] },
        { atMs: 3000, names: ["John Smith"] },
        { atMs: 4000, names: ["Mary Tran"] },
      ],
    });
    expect(result).toEqual([]);
  });

  it("never overwrites an existing speaker mapping", () => {
    const result = inferRosterSpeakerMappings({
      segments: [segments[0]],
      participantNames: ["John Smith"],
      observations: [
        { atMs: 1000, names: ["John Smith"] },
        { atMs: 2000, names: ["John Smith"] },
      ],
      existingMappings: [{ speakerKey: "speaker_1", displayName: "Manual Name" }],
    });
    expect(result).toEqual([]);
  });
});
