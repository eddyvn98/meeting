/**
 * lib/meeting/minutesDocx/document.ts
 *
 * Builds word/document.xml — the only data-dependent part of the
 * generated MOM .docx (see parts.ts for the static parts and index.ts for
 * the package assembly). Mirrors the on-screen MOM layout
 * (app/(tools)/meeting/[meetingId]/minutes/**): title, header fields,
 * attendance table, minutes table, footer block.
 */

import type { MeetingMinutes } from "../types";
import type { AttendanceSectionItem, MinutesMatter } from "../overviewSections";
import { formatActionParenthetical, formatResponsibleList, formatMatterNumber } from "../minutesFormat";
import { resolveMinutesLabels, type MinutesLabels } from "../minutesLabels";
import { escapeXml, paragraph, bulletParagraph, run, cell, row } from "./xml";

export interface MinutesDocxData {
  minutes: MeetingMinutes;
  attendance: AttendanceSectionItem[];
  matters: MinutesMatter[];
  /** Fixed wording (headings, headers, footer labels); English when omitted. */
  labels?: MinutesLabels;
}

/** A4 page (11906 x 16838 dxa) with ~2cm margins (1134 dxa each side) per
 *  the export spec. Content width = 11906 - 2*1134 = 9638 dxa — every
 *  table's column widths below must sum to this. */
const PAGE_WIDTH_DXA = 11906;
const PAGE_HEIGHT_DXA = 16838;
const MARGIN_DXA = 1134;
const CONTENT_WIDTH_DXA = PAGE_WIDTH_DXA - MARGIN_DXA * 2;

const HEADER_SHADE = "D9D9D9";

const STATUS_LABEL: Record<"present" | "regrets", string> = {
  present: "✔", // check mark
  regrets: "0",
};

function fieldLine(label: string, value: string | null): string {
  if (!value) return "";
  return paragraph([run(`${label}: `, { bold: true }), run(value)]);
}

// Attendance table: Name / Role / Organization / Present-Regrets, ~34/24/24/18%.
const ATTENDANCE_COLS = {
  name: Math.round(CONTENT_WIDTH_DXA * 0.34),
  role: Math.round(CONTENT_WIDTH_DXA * 0.24),
  organization: Math.round(CONTENT_WIDTH_DXA * 0.24),
  status: 0, // filled below to make the four add up exactly
};
ATTENDANCE_COLS.status = CONTENT_WIDTH_DXA - ATTENDANCE_COLS.name - ATTENDANCE_COLS.role - ATTENDANCE_COLS.organization;

function buildAttendanceTable(attendance: AttendanceSectionItem[], labels: MinutesLabels): string {
  const header = row(
    cell(paragraph([run(labels.name, { bold: true })]), { widthDxa: ATTENDANCE_COLS.name, shadeHex: HEADER_SHADE }) +
      cell(paragraph([run(labels.role, { bold: true })]), { widthDxa: ATTENDANCE_COLS.role, shadeHex: HEADER_SHADE }) +
      cell(paragraph([run(labels.organization, { bold: true })]), { widthDxa: ATTENDANCE_COLS.organization, shadeHex: HEADER_SHADE }) +
      cell(paragraph([run(labels.presentRegrets, { bold: true })], { align: "center" }), {
        widthDxa: ATTENDANCE_COLS.status,
        shadeHex: HEADER_SHADE,
        centerVertical: true,
      }),
    { header: true },
  );

  const bodyRows =
    attendance.length === 0
      ? row(
          cell(paragraph([run(labels.noAttendees)]), { widthDxa: ATTENDANCE_COLS.name }) +
            cell(paragraph(""), { widthDxa: ATTENDANCE_COLS.role }) +
            cell(paragraph(""), { widthDxa: ATTENDANCE_COLS.organization }) +
            cell(paragraph(""), { widthDxa: ATTENDANCE_COLS.status }),
        )
      : attendance
          .map((item) => {
            const status = item.status ? STATUS_LABEL[item.status] : "";
            return row(
              cell(paragraph(item.name), { widthDxa: ATTENDANCE_COLS.name }) +
                cell(paragraph(item.role ?? ""), { widthDxa: ATTENDANCE_COLS.role }) +
                cell(paragraph(item.organization ?? ""), { widthDxa: ATTENDANCE_COLS.organization }) +
                cell(paragraph(status, { align: "center" }), { widthDxa: ATTENDANCE_COLS.status, centerVertical: true }),
            );
          })
          .join("");

  return `<w:tbl>
    <w:tblPr>
      <w:tblW w:w="${CONTENT_WIDTH_DXA}" w:type="dxa"/>
      <w:tblLayout w:type="fixed"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="4" w:color="666666"/>
        <w:left w:val="single" w:sz="4" w:color="666666"/>
        <w:bottom w:val="single" w:sz="4" w:color="666666"/>
        <w:right w:val="single" w:sz="4" w:color="666666"/>
        <w:insideH w:val="single" w:sz="4" w:color="666666"/>
        <w:insideV w:val="single" w:sz="4" w:color="666666"/>
      </w:tblBorders>
      <w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>
    </w:tblPr>
    <w:tblGrid>
      <w:gridCol w:w="${ATTENDANCE_COLS.name}"/>
      <w:gridCol w:w="${ATTENDANCE_COLS.role}"/>
      <w:gridCol w:w="${ATTENDANCE_COLS.organization}"/>
      <w:gridCol w:w="${ATTENDANCE_COLS.status}"/>
    </w:tblGrid>
    ${header}
    ${bodyRows}
  </w:tbl>`;
}

// Minutes table: S/N | Matter Discussed | Action to be taken | Responsible
// at 5% / 50% / 27% / 18% of content width.
const MINUTES_COLS = {
  sn: Math.round(CONTENT_WIDTH_DXA * 0.07),
  matter: Math.round(CONTENT_WIDTH_DXA * 0.48),
  action: Math.round(CONTENT_WIDTH_DXA * 0.27),
  responsible: 0,
};
MINUTES_COLS.responsible = CONTENT_WIDTH_DXA - MINUTES_COLS.sn - MINUTES_COLS.matter - MINUTES_COLS.action;
const MINUTES_SPAN_WIDTH_DXA = MINUTES_COLS.matter + MINUTES_COLS.action + MINUTES_COLS.responsible;

function buildMinutesHeaderRow(labels: MinutesLabels): string {
  return row(
    cell(paragraph([run(labels.serialNumber, { bold: true })], { align: "center" }), { widthDxa: MINUTES_COLS.sn, shadeHex: HEADER_SHADE, centerVertical: true }) +
      cell(paragraph([run(labels.matterDiscussed, { bold: true })]), { widthDxa: MINUTES_COLS.matter, shadeHex: HEADER_SHADE }) +
      cell(paragraph([run(labels.actionToBeTaken, { bold: true })]), { widthDxa: MINUTES_COLS.action, shadeHex: HEADER_SHADE }) +
      cell(paragraph([run(labels.responsible, { bold: true })]), { widthDxa: MINUTES_COLS.responsible, shadeHex: HEADER_SHADE }),
    { header: true },
  );
}

/** One matter: a heading row (S/N + bold uppercase title spanning the
 *  Matter column) followed by one row per matter row (discussion bullets /
 *  actions with parenthetical / responsible lines). */
function buildMatterRows(matter: MinutesMatter, matterIndex: number, labels: MinutesLabels): string {
  const heading = row(
    cell(paragraph([run(formatMatterNumber(matterIndex), { bold: true })], { align: "center" }), {
      widthDxa: MINUTES_COLS.sn,
      centerVertical: true,
    }) +
      cell(paragraph([run(matter.title.toUpperCase(), { bold: true })]), { widthDxa: MINUTES_SPAN_WIDTH_DXA, gridSpan: 3 }),
  );

  if (matter.rows.length === 0) {
    return `${heading}${row(
      cell(paragraph(""), { widthDxa: MINUTES_COLS.sn }) +
        cell(paragraph([run(labels.noDetails, { italic: true })]), { widthDxa: MINUTES_SPAN_WIDTH_DXA, gridSpan: 3 }),
    )}`;
  }

  const bodyRows = matter.rows
    .map((r) => {
      const discussionXml = r.discussion.length > 0 ? r.discussion.map((line) => bulletParagraph(line)).join("") : paragraph("");

      const actionsXml =
        r.actions.length > 0
          ? r.actions
              .map((action) => {
                const suffix = formatActionParenthetical(action, labels.ongoing);
                const textPara = paragraph(action.text);
                const suffixPara = suffix ? paragraph([run(suffix, { bold: true, italic: true })]) : "";
                return textPara + suffixPara;
              })
              .join(paragraph(""))
          : paragraph("");

      const responsible = formatResponsibleList(r.responsible);
      const responsibleXml = responsible ? responsible.split(",").map((name) => paragraph(name.trim())).join("") : paragraph("");

      return row(
        cell(paragraph(""), { widthDxa: MINUTES_COLS.sn }) +
          cell(discussionXml, { widthDxa: MINUTES_COLS.matter }) +
          cell(actionsXml, { widthDxa: MINUTES_COLS.action }) +
          cell(responsibleXml, { widthDxa: MINUTES_COLS.responsible }),
      );
    })
    .join("");

  return heading + bodyRows;
}

function buildMinutesTable(matters: MinutesMatter[], labels: MinutesLabels): string {
  const bodyXml =
    matters.length === 0
      ? row(
          cell(paragraph(""), { widthDxa: MINUTES_COLS.sn }) +
            cell(paragraph([run(labels.noMinutes, { italic: true })]), {
              widthDxa: MINUTES_COLS.matter,
              gridSpan: 3,
            }),
        )
      : matters.map((matter, index) => buildMatterRows(matter, index, labels)).join("");

  return `<w:tbl>
    <w:tblPr>
      <w:tblW w:w="${CONTENT_WIDTH_DXA}" w:type="dxa"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="4" w:color="666666"/>
        <w:left w:val="single" w:sz="4" w:color="666666"/>
        <w:bottom w:val="single" w:sz="4" w:color="666666"/>
        <w:right w:val="single" w:sz="4" w:color="666666"/>
        <w:insideH w:val="single" w:sz="4" w:color="666666"/>
        <w:insideV w:val="single" w:sz="4" w:color="666666"/>
      </w:tblBorders>
      <w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>
    </w:tblPr>
    <w:tblGrid>
      <w:gridCol w:w="${MINUTES_COLS.sn}"/>
      <w:gridCol w:w="${MINUTES_COLS.matter}"/>
      <w:gridCol w:w="${MINUTES_COLS.action}"/>
      <w:gridCol w:w="${MINUTES_COLS.responsible}"/>
    </w:tblGrid>
    ${buildMinutesHeaderRow(labels)}
    ${bodyXml}
  </w:tbl>`;
}

/** Builds the full <w:body> content (everything inside word/document.xml's
 *  <w:document>) for `data`. Every piece of user/meeting text passes
 *  through xml.ts's `escapeXml` inside `run`/`paragraph`/`cell` — nothing
 *  here interpolates raw strings directly into the XML. */
export function buildDocumentBodyXml(data: MinutesDocxData): string {
  const { minutes, attendance, matters } = data;
  const labels = data.labels ?? resolveMinutesLabels();
  // The title is printed as written (the page shows it the same way); a
  // translated version has its own title, so nothing is prefixed to it.
  const title = (minutes.title?.trim() || "Minutes of Meeting").toUpperCase();

  const titlePara = paragraph([run(title, { bold: true })], { align: "center", styleId: "Title" });
  const headerFields = [fieldLine(labels.meetingDate, minutes.meetingDate), fieldLine(labels.meetingTime, minutes.timeRange), fieldLine(labels.meetingVenue, minutes.venue)]
    .filter(Boolean)
    .join("");

  const spacer = paragraph("");

  const footnotePara = minutes.footnote?.trim()
    ? paragraph([run(minutes.footnote.trim(), { italic: true })])
    : "";
  const footerLines = [
    fieldLine(labels.recordedBy, minutes.recordedBy),
    fieldLine(labels.date, minutes.recordedDate),
    fieldLine(labels.distributed, minutes.distributed),
  ]
    .filter(Boolean)
    .join("");
  const footerBlock = footnotePara || footerLines ? spacer + footnotePara + spacer + footerLines : "";

  const sectPr = `<w:sectPr>
    <w:pgSz w:w="${PAGE_WIDTH_DXA}" w:h="${PAGE_HEIGHT_DXA}"/>
    <w:pgMar w:top="${MARGIN_DXA}" w:right="${MARGIN_DXA}" w:bottom="${MARGIN_DXA}" w:left="${MARGIN_DXA}" w:header="708" w:footer="708" w:gutter="0"/>
  </w:sectPr>`;

  return `<w:body>
    ${titlePara}
    ${headerFields}
    ${spacer}
    ${buildAttendanceTable(attendance, labels)}
    ${spacer}
    ${buildMinutesTable(matters, labels)}
    ${footerBlock}
    ${sectPr}
  </w:body>`;
}

export function buildDocumentXml(data: MinutesDocxData): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${buildDocumentBodyXml(data)}</w:document>
`;
}

export { escapeXml };
