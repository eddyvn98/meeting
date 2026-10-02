import type { TableCellAlign, TableCellAttachment } from "./block";

export type TableCellAlignment = "left" | "center" | "right";

export interface TableCellMarks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface TableCellRun {
  text: string;
  marks?: TableCellMarks;
  fontSize?: number;
}

export interface TableCellParagraph {
  type: "paragraph";
  align?: TableCellAlignment;
  runs: TableCellRun[];
}

export type TableCellValue = string | number | boolean;

export interface TableCellFormat {
  fa: string;
  t?: string;
}

export interface TableCellContent {
  version: 1;
  blocks: TableCellParagraph[];
}

export type TableMode = "document" | "spreadsheet";

/** A column's data kind, set per-column (not per-cell) via the header
 *  control - mirrors a lightweight "database view" (Miro/Notion-style typed
 *  table columns) layered on top of the plain string grid: the underlying
 *  `cells[row][col]` stays a string for every type (an option id for
 *  "select", an ISO date for "date", a numeric string for "number"), so
 *  every existing per-row/per-cell op (insert/delete/duplicate/move/paste)
 *  keeps working unchanged. Absent/"text" is the original free-text cell. */
export type TableColumnType = "text" | "person" | "date" | "number" | "select";

export interface TableColumnOption {
  id: string;
  label: string;
  color: string;
}

export interface TableSortSpec {
  col: number;
  dir: "asc" | "desc";
}

export interface TableFilterSpec {
  col: number;
  optionId: string;
}

/** The `table` block's full data payload - defined here (not inline in
 *  BlockDataMap) so block.ts stays well under its 300-line cap. */
export interface TableBlockPayload {
  rows: number;
  cols: number;
  cells: string[][];
  /** Table content auto-sizes its block until the user resizes it manually. */
  autoFitContent?: boolean;
  /** Document mode keeps leading '=' as text; spreadsheet mode evaluates it. */
  mode?: TableMode;
  /** Formula source is kept separately from the evaluated value in cells. */
  formulas?: (string | undefined)[][];
  /** Raw spreadsheet values preserve numeric/date semantics while `cells` stores display text for canvas rendering. */
  cellValues?: (TableCellValue | undefined)[][];
  /** Per-cell number/date/text format metadata from FortuneSheet. */
  cellFormats?: (TableCellFormat | undefined)[][];
  /** Format applied to a whole spreadsheet column without inflating canvas row count. */
  columnFormats?: (TableCellFormat | undefined)[];
  headerRow?: boolean;
  headerCol?: boolean;
  cellContents?: TableCellContent[][];
  rowWeights?: number[];
  colWeights?: number[];
  cellFontSizes?: number[][];
  cellAlign?: (TableCellAlign | undefined)[][];
  cellBgColor?: (string | undefined)[][];
  cellTextColor?: (string | undefined)[][];
  merges?: { row: number; col: number; rowSpan: number; colSpan: number }[];
  cellItems?: Record<string, TableCellAttachment[]>;
  passThroughEmptyCellClicks?: boolean;
  disableCellAttachment?: boolean;
  /** Column type/options/sort/filter - all indexed by column, all optional
   *  (absent = every column is plain "text", no sort/filter applied). */
  columnTypes?: TableColumnType[];
  columnSelectOptions?: Record<number, TableColumnOption[]>;
  sortCol?: TableSortSpec | null;
  filterCol?: TableFilterSpec | null;
}
