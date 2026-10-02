import { describe, expect, it } from "vitest";
import type { MeetingMinutes } from "@/lib/meeting/types";
import { buildDocumentXml } from "@/lib/meeting/minutesDocx/document";
import type { MinutesMatter } from "@/lib/meeting/overviewSections";

const minutes: MeetingMinutes = {
  id: "minutes-1",
  meetingId: "meeting-1",
  title: "MINUTES OF A LONG PROJECT REVIEW",
  meetingDate: "2 Oct 2026",
  timeRange: "15:00 - 16:00",
  venue: "Online",
  footnote: null,
  recordedBy: "Recorder",
  recordedDate: "2 Oct 2026",
  distributed: "All attendees",
  isDefault: false,
  createdAt: "2026-10-02T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  attendanceSuggestions: [],
  knownPeople: [],
};

describe("minutes DOCX page layout", () => {
  it("uses fixed-width A4 tables and correct widths for cells spanning the last three columns", () => {
    const matter: MinutesMatter = {
      id: "matter-1",
      title: "A matter with enough text to wrap across the page",
      rows: [],
    };

    const xml = buildDocumentXml({ minutes, attendance: [], matters: [matter] });

    expect(xml.match(/<w:tblLayout w:type="fixed"\/>/g)).toHaveLength(2);
    expect(xml).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    // A4 content width is 9638 dxa. The S/N column is 675 dxa, so a cell
    // spanning Matter + Action + Responsible must be exactly 8963 dxa.
    expect(xml).toContain('<w:tcW w:w="8963" w:type="dxa"/><w:gridSpan w:val="3"/>');
    // Long rows intentionally remain splittable across pages.
    expect(xml).not.toContain("<w:cantSplit/>");
  });

  it("keeps the empty minutes message within the same fixed table grid", () => {
    const xml = buildDocumentXml({ minutes, attendance: [], matters: [] });
    expect(xml).toContain('<w:tcW w:w="8963" w:type="dxa"/><w:gridSpan w:val="3"/>');
  });
});
