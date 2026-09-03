import type {
  ContentCellValue,
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
  ContentSheetColumn,
  ContentSheetPrintSettings,
  ContentSheetRow,
  DocumentTree,
} from "document-schema.js";
import { assembleTree, PAGE_SIZE_LETTER } from "document-schema.js";

import { BOF_TYPE_WORKSHEET, RECORD_FILEPASS } from "./biff/record-types";
import { BiffFormatError, readRecords } from "./biff/records";
import {
  groupRecords,
  splitSubstreams,
  type Substream,
} from "./biff/substreams";
import { readWorkbookStream } from "./container";
import { classifyNumberFormat } from "./number-format";
import {
  serialToIsoDate,
  serialToIsoDateTime,
  serialToIsoTime,
} from "./serial";
import {
  formatCodeOf,
  readWorkbookGlobals,
  type SheetEntry,
  type WorkbookGlobals,
} from "./workbook/globals";
import {
  readSheetRecords,
  type RawCell,
  type RawSheet,
} from "./workbook/sheet";

// The join between the BIFF8 record readers and document-schema.js's own spreadsheet vocabulary.
//
// The target shape is deliberately the one ooxml.js's readXlsxContent produces, field for field: a ContentDocument of kind 'spreadsheet' holding one ContentSheet per sheet, each with a SPARSE, zero-based cell array (a cell with nothing to show is simply absent, never materialised as an empty one), displayText on every cell, and a numeric cell's real kind resolved through its number format rather than left as a bare number. A caller converting .xls and .xlsx therefore holds the same type with the same conventions, which is the entire point of the shared schema.
//
// The one structural difference is the input. An .xlsx decodes to a Package first, and readXlsxContent takes that; a .xls has no equivalent intermediate -- the compound-file container yields one opaque byte stream -- so these take the file's own bytes.

/**
 * The spreadsheet member of ContentDocument's own discriminated union.
 *
 * Named and returned in place of the bare union, which is what ooxml.js's readXlsxContent declares. A .xls is a spreadsheet by construction -- there is no input this reader could accept that produced a wordprocessing or presentation document -- so returning the union would force every caller to re-narrow on `kind` to reach `sheets`, discarding a fact this function already knows. The narrowed type stays assignable to ContentDocument, so a caller holding one (documents.js's conversion registry among them) is unaffected.
 */
export type XlsContentDocument = Extract<
  ContentDocument,
  { kind: "spreadsheet" }
>;

/** Which BoundSheet8 dt values name a sheet this reader maps. 0x00 is a worksheet or dialog sheet; macro sheets, chart sheets, and VBA modules carry no cell table for ContentSheet to hold. */
const SHEET_TYPE_WORKSHEET = 0x00;

/**
 * Print settings this package emits rather than reads.
 *
 * ContentSheetPrintSettings makes pageSize, margins, gridlines, headers, and pageOrder REQUIRED, so a sheet cannot be produced without them, and BIFF8 spreads the real values across the Setup, LeftMargin/RightMargin/TopMargin/BottomMargin, PrintGrid, and PrintRowCol records plus a paper-size code table. None of those is read yet, so these are Excel's own documented "Normal" preset -- the same constants ooxml.js falls back to for an xlsx carrying no pageMargins element -- and they are honest defaults rather than the file's own settings. Reading the real ones is tracked as remaining scope rather than guessed at from unverified field offsets.
 */
const POINTS_PER_INCH = 72;
const DEFAULT_PRINT_SETTINGS: ContentSheetPrintSettings = {
  pageSize: PAGE_SIZE_LETTER,
  margins: {
    topPt: 0.75 * POINTS_PER_INCH,
    rightPt: 0.7 * POINTS_PER_INCH,
    bottomPt: 0.75 * POINTS_PER_INCH,
    leftPt: 0.7 * POINTS_PER_INCH,
  },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

/**
 * Reads a .xls file's bytes into a ContentDocument.
 *
 * The counterpart of ooxml.js's readXlsxContent, producing the same shape from the older format.
 */
export function readXlsContent(
  bytes: Uint8Array<ArrayBuffer>,
): XlsContentDocument {
  const substreams = splitSubstreams(
    groupRecords(readRecords(readWorkbookStream(bytes))),
  );
  const globalsSubstream = substreams[0];
  if (globalsSubstream === undefined) {
    throw new BiffFormatError(
      "workbook stream holds no substreams, so it carries no globals substream",
    );
  }
  // [MS-XLS] 2.4.117: a FilePass record means the workbook's contents are encrypted, and every record after it is ciphertext. Reading on would produce confident nonsense, so this fails loudly instead.
  if (globalsSubstream.records.some((rec) => rec.type === RECORD_FILEPASS)) {
    throw new BiffFormatError(
      "workbook is encrypted (its globals substream carries a FilePass record); this reader does not decrypt",
    );
  }
  const globals = readWorkbookGlobals(globalsSubstream.records);
  const sheets = globals.sheets
    .filter((entry) => entry.sheetType === SHEET_TYPE_WORKSHEET)
    .map((entry) => readSheet(entry, substreams, globals));
  return { kind: "spreadsheet", metadata: {}, sheets };
}

/** The tree-form read: readXlsContent composed with the schema's own structural transform, exactly as ooxml.js's readXlsx wraps readXlsxContent. */
export function readXls(bytes: Uint8Array<ArrayBuffer>): DocumentTree {
  return assembleTree(readXlsContent(bytes));
}

/**
 * Locates a sheet's own substream and maps it.
 *
 * The substream is found by the byte offset BoundSheet8's lbPlyPos names, not by position: the order sheets appear in the workbook (which is BoundSheet8 order, and therefore the order of `globals.sheets`) is not required to match the order their substreams were written in. A sheet whose substream cannot be found still produces a ContentSheet, empty -- losing the sheet entirely would be a worse answer than losing its cells, since its name and position are real information the workbook did state.
 */
function readSheet(
  entry: SheetEntry,
  substreams: readonly Substream[],
  globals: WorkbookGlobals,
): ContentSheet {
  const substream = substreams.find(
    (candidate) =>
      candidate.offset === entry.bofPosition &&
      candidate.documentType === BOF_TYPE_WORKSHEET,
  );
  const raw: RawSheet =
    substream === undefined
      ? { cells: [], rows: [], columns: [], merges: [] }
      : readSheetRecords(substream.records, globals.sharedStrings);
  return {
    name: entry.name,
    cells: mapCells(raw, globals),
    columns: mapColumns(raw),
    rows: mapRows(raw),
    images: [],
    printSettings: DEFAULT_PRINT_SETTINGS,
  };
}

function mapRows(raw: RawSheet): ContentSheetRow[] {
  const rows: ContentSheetRow[] = [];
  for (const row of raw.rows) {
    // A row record carrying neither a declared height nor a hidden state states nothing the schema has a place for, so it is not materialised.
    if (row.heightPt === undefined && !row.hidden) {
      continue;
    }
    const entry: ContentSheetRow = { index: row.index };
    if (row.heightPt !== undefined) {
      entry.heightPt = row.heightPt;
    }
    if (row.hidden) {
      entry.hidden = true;
    }
    rows.push(entry);
  }
  return rows;
}

function mapColumns(raw: RawSheet): ContentSheetColumn[] {
  const columns: ContentSheetColumn[] = [];
  for (const column of raw.columns) {
    if (column.widthPt === undefined && !column.hidden) {
      continue;
    }
    const entry: ContentSheetColumn = { index: column.index };
    if (column.widthPt !== undefined) {
      entry.widthPt = column.widthPt;
    }
    if (column.hidden) {
      entry.hidden = true;
    }
    columns.push(entry);
  }
  return columns;
}

/** Maps the raw cells, then stamps merged-range spans onto their anchor cells. */
function mapCells(raw: RawSheet, globals: WorkbookGlobals): ContentSheetCell[] {
  const cells: ContentSheetCell[] = [];
  for (const cell of raw.cells) {
    const mapped = mapCell(cell, globals);
    if (mapped !== undefined) {
      cells.push(mapped);
    }
  }
  applyMerges(cells, raw);
  return cells;
}

/**
 * Maps one raw cell, or drops it.
 *
 * A blank cell carrying no merge is dropped: ContentSheet's cell array is documented as sparse, holding only cells with something to show, and a Blank or MulBlank record states formatting this reader does not map yet. Dropping it keeps the array honest rather than filling a sheet with thousands of empty entries -- applyMerges below re-materialises the few blanks that anchor a merged range.
 */
function mapCell(
  cell: RawCell,
  globals: WorkbookGlobals,
): ContentSheetCell | undefined {
  if (cell.value.kind === "blank") {
    return undefined;
  }
  const formatCode = formatCodeOf(globals, cell.xfIndex);
  const value = resolveValue(cell, formatCode, globals.date1904);
  const mapped: ContentSheetCell = {
    row: cell.row,
    column: cell.column,
    value,
    displayText: displayTextOf(value),
  };
  if (formatCode !== undefined) {
    mapped.numberFormatCode = formatCode;
  }
  return mapped;
}

/**
 * Resolves a raw value into a ContentCellValue, classifying a number through its own format code.
 *
 * This is where BIFF8's lack of temporal and percentage cell types is undone: every date, time, percentage, and currency amount is stored as a bare number, and only the format its XF points at says which. A format naming a date the calendar does not have (the 1900 system's phantom leap day, or a negative serial) degrades to the plain number rather than emitting an invalid ISO string.
 */
function resolveValue(
  cell: RawCell,
  formatCode: string | undefined,
  date1904: boolean,
): ContentCellValue {
  // The two vocabularies name an absent value differently -- BIFF8's record family calls it blank, the schema calls it empty -- so the translation is spelled out rather than left to a structural coincidence. mapCell already drops a blank cell before reaching here; this branch is what keeps the function total for the one that survives as a merge anchor.
  if (cell.value.kind === "blank") {
    return { kind: "empty" };
  }
  if (cell.value.kind !== "number") {
    return cell.value;
  }
  const num = cell.value.value;
  if (formatCode === undefined) {
    return { kind: "number", value: num };
  }
  const format = classifyNumberFormat(formatCode);
  switch (format.kind) {
    case "percentage":
      // The stored value stays the raw fraction, which is both what ContentCellValue's percentage variant carries and what a percent-formatted cell holds in every real file; the multiplication by a hundred lives purely in the rendering.
      return { kind: "percentage", value: num };
    case "currency":
      return format.code === undefined
        ? { kind: "currency", value: num }
        : { kind: "currency", value: num, currency: format.code };
    case "date": {
      const iso = serialToIsoDate(num, date1904);
      return iso === undefined
        ? { kind: "number", value: num }
        : { kind: "date", value: iso };
    }
    case "time": {
      const iso = serialToIsoTime(num);
      return iso === undefined
        ? { kind: "number", value: num }
        : { kind: "time", value: iso };
    }
    case "dateTime": {
      const iso = serialToIsoDateTime(num, date1904);
      return iso === undefined
        ? { kind: "number", value: num }
        : { kind: "dateTime", value: iso };
    }
    default:
      // 'elapsedTime' lands here deliberately alongside 'number' and 'text': a duration may exceed 24 hours, so it has no wall-clock spelling ContentCellValue's own 'time' variant could carry without misrepresenting it.
      return { kind: "number", value: num };
  }
}

/** The typed value's own spelling, matching ooxml.js's derivation exactly so the same cell reads identically from either format. Deliberately not the producer's rendered string: this package classifies number formats but does not render through them. */
function displayTextOf(value: ContentCellValue): string {
  switch (value.kind) {
    case "number":
    case "percentage":
    case "currency":
      return String(value.value);
    case "boolean":
      return value.value ? "TRUE" : "FALSE";
    case "date":
    case "time":
    case "dateTime":
    case "string":
    case "error":
      return value.value;
    case "empty":
      return "";
    default:
      return "";
  }
}

/**
 * Stamps each merged range's span onto its anchor cell, materialising an empty anchor when the range's top-left cell had no value of its own.
 *
 * ContentSheetCell documents colSpan/rowSpan as belonging to the anchor cell alone, and only when greater than one. A merged range whose anchor is blank is common -- merging cells in Excel keeps only the top-left value, and a range merged over an empty cell has no value anywhere -- so the anchor is created here rather than left absent, which would lose the merge entirely.
 */
function applyMerges(cells: ContentSheetCell[], raw: RawSheet): void {
  for (const range of raw.merges) {
    const rowSpan = range.endRow - range.startRow + 1;
    const colSpan = range.endColumn - range.startColumn + 1;
    if (rowSpan <= 1 && colSpan <= 1) {
      continue;
    }
    let anchor = cells.find(
      (cell) =>
        cell.row === range.startRow && cell.column === range.startColumn,
    );
    if (anchor === undefined) {
      anchor = {
        row: range.startRow,
        column: range.startColumn,
        value: { kind: "empty" },
        displayText: "",
      };
      cells.push(anchor);
    }
    if (colSpan > 1) {
      anchor.colSpan = colSpan;
    }
    if (rowSpan > 1) {
      anchor.rowSpan = rowSpan;
    }
  }
}
