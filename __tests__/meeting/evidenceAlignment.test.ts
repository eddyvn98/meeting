import { describe, expect, it } from "vitest";
import {
  alignEvidenceSegmentIds,
  buildEvidenceIdRemap,
  remapEvidenceInJson,
} from "@/lib/meeting/ai/evidenceAlignment";

describe("Overview evidence alignment", () => {
  const finalRows = [
    { id: "final-a", startTimeMs: 0, endTimeMs: 8_000 },
    { id: "final-b", startTimeMs: 8_000, endTimeMs: 18_000 },
  ];

  it("aligns early STT evidence indexes to the final diarized rows by time overlap", () => {
    expect(
      alignEvidenceSegmentIds(
        [
          { start: 1, end: 4 },
          { start: 9, end: 12 },
          { start: 17, end: 17.5 },
        ],
        finalRows,
      ),
    ).toEqual(["final-a", "final-b", "final-b"]);
  });

  it("remaps saved evidence ids when diarization replaces transcript rows", () => {
    const previousRows = [
      { id: "raw-1", startTimeMs: 0, endTimeMs: 4_000 },
      { id: "raw-2", startTimeMs: 4_000, endTimeMs: 9_000 },
      { id: "raw-3", startTimeMs: 9_000, endTimeMs: 13_000 },
    ];
    const idMap = buildEvidenceIdRemap(previousRows, finalRows);

    expect(idMap.get("raw-1")).toBe("final-a");
    expect(idMap.get("raw-3")).toBe("final-b");

    expect(
      remapEvidenceInJson(
        [
          {
            id: "item-1",
            evidenceSegmentIds: ["raw-1"],
            nested: { evidenceSegmentIds: ["raw-3"] },
          },
        ],
        idMap,
      ),
    ).toEqual([
      {
        id: "item-1",
        evidenceSegmentIds: ["final-a"],
        nested: { evidenceSegmentIds: ["final-b"] },
      },
    ]);
  });
});
