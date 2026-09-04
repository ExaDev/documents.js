import {
  readSummaryInformation,
  summaryInformationToLayoutMetadata,
} from "archive-codec";
import type {
  Color,
  ContentCellBorders,
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

import { pageSizeFromSetup } from "./biff/print-setup";
import { BOF_TYPE_WORKSHEET, RECORD_FILEPASS } from "./biff/record-types";
import { BiffFormatError, readRecords } from "./biff/records";
import {
  groupRecords,
  splitSubstreams,
  type Substream,
} from "./biff/substreams";
import { resolveFillBackground, resolveBorderEdge } from "./biff/xf-colors";
import { readWorkbookStreams } from "./container";
import { classifyNumberFormat } from "excel-number-format";
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
import type { SheetPrintNames } from "./workbook/print-names";
import {
  readSheetRecords,
  type RawCell,
  type RawPrintSettings,
  type RawSheet,
} from "./workbook/sheet";
import { inchesToPoints } from "./units";

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
 * Excel's own "Normal" page-setup preset, the per-field fallback for a print setting the file states nothing about.
 *
 * ContentSheetPrintSettings makes pageSize, margins, gridlines, headers, and pageOrder REQUIRED, while [MS-XLS] 2.1.7.20.6's own PAGESETUP production makes every record behind them optional -- so a sheet whose page setup was never touched genuinely carries no Setup and no margin records, and something has to stand in. These are the values Excel itself calls Normal (top/bottom 0.75in, left/right 0.7in, on Letter paper, gridlines and row/column headers not printed, pages down-then-over), and the identical constants ooxml.js falls back to for an xlsx carrying no pageMargins element -- so the same untouched sheet reads the same either way.
 *
 * Each field falls back independently: a sheet that declares a left margin and nothing else keeps its real left margin and takes the preset for the other three, rather than the whole preset displacing the one value the file actually stated.
 */
const DEFAULT_PRINT_SETTINGS: ContentSheetPrintSettings = {
  pageSize: PAGE_SIZE_LETTER,
  margins: {
    topPt: inchesToPoints(0.75),
    rightPt: inchesToPoints(0.7),
    bottomPt: inchesToPoints(0.75),
    leftPt: inchesToPoints(0.7),
  },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver",
};

/**
 * The print settings a sheet's own records and its built-in print names state, with the Normal preset filling in what they do not.
 *
 * Two of BIFF8's own conditional rules are honoured rather than flattened. A Setup record whose fNoPls bit is set declares its own paper size and scale undefined ([MS-XLS] 2.4.257: "whether the iPaperSize, iScale, iRes, iVRes, iCopies, fNoOrient, and fPortrait data are undefined and ignored"), so neither is read from it -- the page size falls back to the preset and no scalePercent is reported, rather than a paper code the file itself disowns being resolved into a confident page size. And WsBool's own fFitToPage decides which of Setup's two mutually exclusive scaling fields is live: iFitWidth/iFitHeight when set, iScale when clear. Real producers write both regardless (confirmed against LibreOffice-written BIFF8, which carries iScale=100 alongside a real fit-to-page pair, and a real iScale alongside iFitWidth=iFitHeight=1), so reading both would report a scale and a page count that contradict each other.
 */
function mapPrintSettings(
  raw: RawPrintSettings,
  names: SheetPrintNames | undefined,
): ContentSheetPrintSettings {
  const setup = raw.setup;
  const usable = setup !== undefined && !setup.noPls;
  const settings: ContentSheetPrintSettings = {
    pageSize:
      (usable ? pageSizeFromSetup(setup) : undefined) ??
      DEFAULT_PRINT_SETTINGS.pageSize,
    margins: {
      topPt: raw.marginsPt.top ?? DEFAULT_PRINT_SETTINGS.margins.topPt,
      rightPt: raw.marginsPt.right ?? DEFAULT_PRINT_SETTINGS.margins.rightPt,
      bottomPt: raw.marginsPt.bottom ?? DEFAULT_PRINT_SETTINGS.margins.bottomPt,
      leftPt: raw.marginsPt.left ?? DEFAULT_PRINT_SETTINGS.margins.leftPt,
    },
    gridlines: raw.printGridlines ?? DEFAULT_PRINT_SETTINGS.gridlines,
    headers: raw.printHeaders ?? DEFAULT_PRINT_SETTINGS.headers,
    // fLeftToRight is not conditioned on fNoPls: [MS-XLS] 2.4.257 lists exactly which fields that bit invalidates, and the page order is not among them.
    pageOrder: setup?.leftToRight === true ? "overThenDown" : "downThenOver",
  };

  if (setup !== undefined && raw.fitToPage === true) {
    // 0 is [MS-XLS] 2.4.257's own "use as many pages as necessary to print the columns/rows in the sheet", an auto setting ContentSheetPrintSettings.fitToPages cannot express -- both its counts are required and positive. A fit-to-page sheet with an auto axis therefore reports no fitToPages at all rather than a fabricated 1, which would claim the sheet is pinned to a single page along an axis the file left free.
    if (setup.fitWidth > 0 && setup.fitHeight > 0) {
      settings.fitToPages = {
        width: setup.fitWidth,
        height: setup.fitHeight,
      };
    }
  } else if (usable && setup.scalePercent > 0) {
    settings.scalePercent = setup.scalePercent;
  }

  if (raw.rowBreaks.length > 0 || raw.columnBreaks.length > 0) {
    settings.manualBreaks = {
      rows: [...raw.rowBreaks],
      columns: [...raw.columnBreaks],
    };
  }

  if (names?.printRange !== undefined) {
    settings.printRange = names.printRange;
  }
  if (names?.repeatRows !== undefined) {
    settings.repeatRows = names.repeatRows;
  }
  if (names?.repeatColumns !== undefined) {
    settings.repeatColumns = names.repeatColumns;
  }
  return settings;
}

/**
 * Reads a .xls file's bytes into a ContentDocument.
 *
 * The counterpart of ooxml.js's readXlsxContent, producing the same shape from the older format.
 */
export function readXlsContent(
  bytes: Uint8Array<ArrayBuffer>,
): XlsContentDocument {
  const { workbook, metadata } = readWorkbookStreams(bytes);
  const substreams = splitSubstreams(groupRecords(readRecords(workbook)));
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
  // Indexed before filtering, not after: a print name's own itab is a position in the FULL BoundSheet8 collection, so a workbook whose first sheet is a chart would mis-key every print name if the index came from the filtered list.
  const sheets = globals.sheets
    .map((entry, sheetIndex) => ({ entry, sheetIndex }))
    .filter(({ entry }) => entry.sheetType === SHEET_TYPE_WORKSHEET)
    .map(({ entry, sheetIndex }) =>
      readSheet(entry, sheetIndex, substreams, globals),
    );
  // Absent when the container carries no "\x05SummaryInformation" stream at all -- a valid BIFF8 workbook need not have one -- and mapped from it through summaryInformationToLayoutMetadata (see src/metadata.ts) otherwise.
  return {
    kind: "spreadsheet",
    metadata:
      metadata === undefined
        ? {}
        : summaryInformationToLayoutMetadata(readSummaryInformation(metadata)),
    sheets,
  };
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
  sheetIndex: number,
  substreams: readonly Substream[],
  globals: WorkbookGlobals,
): ContentSheet {
  const substream = substreams.find(
    (candidate) =>
      candidate.offset === entry.bofPosition &&
      candidate.documentType === BOF_TYPE_WORKSHEET,
  );
  const emptyPrint: RawPrintSettings = {
    marginsPt: {},
    rowBreaks: [],
    columnBreaks: [],
  };
  const raw: RawSheet =
    substream === undefined
      ? { cells: [], rows: [], columns: [], merges: [], print: emptyPrint }
      : readSheetRecords(substream.records, globals.sharedStrings, {
          sheets: globals.sheets,
          sheetRanges: globals.sheetRanges,
        });
  return {
    name: entry.name,
    cells: mapCells(raw, globals),
    columns: mapColumns(raw),
    rows: mapRows(raw),
    images: [],
    // The sheet index a print name is scoped to is its BoundSheet8 position -- the index into globals.sheets, before the worksheet-only filter readXlsContent applies -- not its position among the sheets that survive that filter.
    printSettings: mapPrintSettings(
      raw.print,
      globals.printNames.get(sheetIndex),
    ),
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
 * A blank cell showing nothing at all is dropped: ContentSheet's cell array is documented as sparse, holding only cells with something to show, and dropping the blanks keeps it honest rather than filling a sheet with thousands of empty entries -- applyMerges below re-materialises the few that anchor a merged range.
 *
 * A Blank or MulBlank record whose own XF carries a background or a border is not that case. Its formatting is the entire reason the record exists -- a producer writes one precisely to say "this cell is empty AND looks like this" -- so it becomes an `empty`-kind cell carrying that decoration, which is also what this package's own writer emits for one.
 */
function mapCell(
  cell: RawCell,
  globals: WorkbookGlobals,
): ContentSheetCell | undefined {
  // Resolved before the blank check, because whether a blank cell is worth carrying is exactly the question of whether these two find anything. Resolved rather than read off the XF's raw fields, so a decoration this reader declines to express -- a fill pattern beyond solid, an unrecognised BorderStyle token, an icv with no fixed RGB value -- counts as none here too.
  const background = backgroundOf(globals, cell.xfIndex);
  const borders = bordersOf(globals, cell.xfIndex);
  if (
    cell.value.kind === "blank" &&
    background === undefined &&
    borders === undefined
  ) {
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
  if (cell.formula !== undefined) {
    mapped.formula = cell.formula;
  }
  if (background !== undefined) {
    mapped.background = background;
  }
  if (borders !== undefined) {
    mapped.borders = borders;
  }
  return mapped;
}

/**
 * A cell's own resolved fill colour, or undefined for a genuinely unfilled cell AND for every fill pattern beyond solid.
 *
 * A non-solid pattern (the 50%/75%/25% gray shades, the stripe and crosshatch family [MS-XLS]'s FillPattern enumeration also names) is a deliberate, permanent gap rather than an oversight: ContentSheetCell.background models one flat colour, and approximating a striped or crosshatched fill as its own foreground colour alone would misreport what the cell actually shows -- see xls-codec's README, "Cell decoration".
 */
function backgroundOf(
  globals: WorkbookGlobals,
  xfIndex: number,
): Color | undefined {
  const format = globals.cellFormats[xfIndex];
  if (format === undefined) {
    return undefined;
  }
  return resolveFillBackground(
    format.decoration.fillPattern,
    format.decoration.fillForegroundIcv,
    globals.palette,
  );
}

/** A cell's own resolved per-side borders, or undefined when none of its four sides carry a border this reader resolves (no border at all, or a reserved/unrecognised BorderStyle token, or a colour this package cannot express as a fixed RGB value -- see xf-colors.ts's own resolveBorderEdge). */
function bordersOf(
  globals: WorkbookGlobals,
  xfIndex: number,
): ContentCellBorders | undefined {
  const format = globals.cellFormats[xfIndex];
  if (format === undefined) {
    return undefined;
  }
  const { decoration } = format;
  const left = resolveBorderEdge(decoration.left, globals.palette);
  const right = resolveBorderEdge(decoration.right, globals.palette);
  const top = resolveBorderEdge(decoration.top, globals.palette);
  const bottom = resolveBorderEdge(decoration.bottom, globals.palette);
  if (
    left === undefined &&
    right === undefined &&
    top === undefined &&
    bottom === undefined
  ) {
    return undefined;
  }
  const borders: ContentCellBorders = {};
  if (left !== undefined) {
    borders.left = left;
  }
  if (right !== undefined) {
    borders.right = right;
  }
  if (top !== undefined) {
    borders.top = top;
  }
  if (bottom !== undefined) {
    borders.bottom = bottom;
  }
  return borders;
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
  // The two vocabularies name an absent value differently -- BIFF8's record family calls it blank, the schema calls it empty -- so the translation is spelled out rather than left to a structural coincidence. mapCell drops an undecorated blank before reaching here; this branch is what a decorated one, and a blank that survives as a merge anchor, resolve through.
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
