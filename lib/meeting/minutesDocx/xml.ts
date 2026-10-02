/**
 * lib/meeting/minutesDocx/xml.ts
 *
 * Small, dependency-free WordprocessingML string helpers shared by
 * document.ts and parts.ts. Kept separate from the part builders so the
 * "how do I escape/emit a run" concerns stay in one small file (< 300
 * lines per AGENTS.md) instead of being duplicated across every part.
 */

/** Strips XML-invalid control characters (everything below U+0020 except
 *  tab \t, newline \n, and carriage return \r) — the XML 1.0 spec forbids
 *  them, and Word will refuse to open a document.xml that contains one. */
export function stripInvalidXmlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** Escapes the five XML-significant characters and strips invalid control
 *  characters. MUST be used for every piece of user/meeting text
 *  interpolated into a WordprocessingML part — title, names, discussion
 *  bullets, action text, etc. are all arbitrary user input even though
 *  this module receives already-validated (by overviewSections.ts's zod
 *  schemas) shapes. */
export function escapeXml(value: string): string {
  return stripInvalidXmlChars(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface RunOptions {
  bold?: boolean;
  italic?: boolean;
}

/** Builds one <w:r> run containing `text`, with `xml:space="preserve"` so
 *  Word doesn't collapse leading/trailing whitespace (needed since MOM
 *  text often has significant spacing around punctuation/parentheticals). */
export function run(text: string, options: RunOptions = {}): string {
  const props: string[] = [];
  if (options.bold) props.push("<w:b/>");
  if (options.italic) props.push("<w:i/>");
  const rPr = props.length > 0 ? `<w:rPr>${props.join("")}</w:rPr>` : "";
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

export interface ParagraphOptions extends RunOptions {
  /** Style id referencing word/styles.xml, e.g. "Title" or "ListBullet". */
  styleId?: string;
  /** Paragraph-level alignment: "center" | "both" (justify) | "left". */
  align?: "center" | "both" | "left";
}

/** Builds a <w:p> paragraph from one or more runs (pre-built with `run`,
 *  or plain text which is wrapped in a single run using `options`). An
 *  empty `runsOrText` still produces a valid empty paragraph (used as
 *  vertical spacing). */
export function paragraph(runsOrText: string | string[], options: ParagraphOptions = {}): string {
  const runsXml = Array.isArray(runsOrText) ? runsOrText.join("") : runsOrText ? run(runsOrText, options) : "";
  const pPrParts: string[] = [];
  if (options.styleId) pPrParts.push(`<w:pStyle w:val="${options.styleId}"/>`);
  if (options.align) pPrParts.push(`<w:jc w:val="${options.align}"/>`);
  const pPr = pPrParts.length > 0 ? `<w:pPr>${pPrParts.join("")}</w:pPr>` : "";
  return `<w:p>${pPr}${runsXml}</w:p>`;
}

/** Builds a bullet-list paragraph referencing numbering.xml's bullet list
 *  (numId 1). Used for a matter row's `discussion` lines. */
export function bulletParagraph(text: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="ListBullet"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(text)}</w:p>`;
}

export interface CellOptions {
  /** Grid-column width in twentieths of a point (dxa). */
  widthDxa: number;
  /** Merge this cell's contents across the row via a horizontal span. */
  gridSpan?: number;
  /** Shade the cell background, e.g. "D9D9D9" for header rows. */
  shadeHex?: string;
  /** Center cell content both ways (used for the ✔/0 attendance column). */
  centerVertical?: boolean;
}

/** Builds a <w:tc> table cell wrapping pre-built paragraph XML. Cells with
 *  no content still need at least one empty paragraph — Word considers a
 *  <w:tc> with no block content invalid. */
export function cell(paragraphsXml: string, options: CellOptions): string {
  const tcPrParts: string[] = [`<w:tcW w:w="${options.widthDxa}" w:type="dxa"/>`];
  if (options.gridSpan && options.gridSpan > 1) tcPrParts.push(`<w:gridSpan w:val="${options.gridSpan}"/>`);
  if (options.shadeHex) tcPrParts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${options.shadeHex}"/>`);
  if (options.centerVertical) tcPrParts.push(`<w:vAlign w:val="center"/>`);
  const content = paragraphsXml || paragraph("");
  return `<w:tc><w:tcPr>${tcPrParts.join("")}</w:tcPr>${content}</w:tc>`;
}

export interface RowOptions {
  /** Marks this row as a header row repeated on every printed page. */
  header?: boolean;
}

/** Builds a <w:tr> table row from pre-built cell XML. `cantSplit` is
 *  deliberately left unset (default Word behavior allows a row to split
 *  across pages) — long minutes rows should be allowed to break rather
 *  than being forced onto a single page. */
export function row(cellsXml: string, options: RowOptions = {}): string {
  const trPr = options.header ? "<w:trPr><w:tblHeader/></w:trPr>" : "";
  return `<w:tr>${trPr}${cellsXml}</w:tr>`;
}
