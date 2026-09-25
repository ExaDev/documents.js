import type { PageSize } from "document-schema.js";

import { inchesToPoints, millimetresToPoints } from "../units";

// The Setup record's own page-format vocabulary ([MS-XLS] 2.4.257) and the WsBool flag that decides how to read it ([MS-XLS] 2.4.351), plus the paper-size code table Setup addresses paper through. This is the one place that vocabulary is packed or unpacked — workbook/sheet.ts's readPrintSettings unpacks it on read, workbook/sheet-writer.ts's print-record writers pack it on write — so the two directions cannot silently disagree about which bit means what, exactly as biff/xf-colors.ts does for the XF payload's own border/fill layout.
//
// BIFF8 spreads one sheet's print settings across nine records in the worksheet substream (Setup, the four margins, PrintGrid, PrintRowCol, and the two page-break records) plus, in the GLOBALS substream, two built-in defined names carrying the print range and the repeated header bands (see workbook/print-names.ts). This module covers the vocabulary of the first group; the record framing itself stays with the readers and writers that walk the substream.

/** Setup.grbit's own bit assignments ([MS-XLS] 2.4.257's fields A through L, in the order that section lists them: fLeftToRight, fPortrait, fNoPls, fNoColor, fDraft, fNotes, fNoOrient, fUsePage, unused1, fEndNotes, iErrors (2 bits), reserved (4 bits)). Only the four this package acts on are named. */
const SETUP_FLAG_LEFT_TO_RIGHT = 0x0001;
const SETUP_FLAG_PORTRAIT = 0x0002;
const SETUP_FLAG_NO_PLS = 0x0004;
const SETUP_FLAG_NO_ORIENT = 0x0040;

/** WsBool's own fFitToPage bit — field G of [MS-XLS] 2.4.351, the ninth bit of its single 16-bit field (fShowAutoBreaks, reserved1 (3 bits), fDialog, fApplyStyles, fRowSumsBelow, fColSumsRight, fFitToPage, ...). */
export const WSBOOL_FLAG_FIT_TO_PAGE = 0x0100;

const HUNDREDTHS_ROUNDING_FACTOR = 100; // module-eval-time table below calls inchPaper/millimetrePaper, which need this const already initialised, so it is declared ahead of the table rather than beside roundToHundredths further down.

/**
 * The Setup record's fields, as this package reads and writes them.
 *
 * `noPls` is carried rather than resolved away, because [MS-XLS] 2.4.257 makes it govern whether five of the others mean anything at all: "A bit that specifies whether the iPaperSize, iScale, iRes, iVRes, iCopies, fNoOrient, and fPortrait data are undefined and ignored." A reader that ignored it would confidently report a paper size and a scale percentage the file itself declares meaningless.
 */
export interface SetupFields {
  /** iPaperSize: an index into the paper-size code table below. Undefined and to be ignored when `noPls` is true. */
  readonly paperCode: number;
  /** iScale: the print scale as a whole percentage ("if the value is 107 then the scaling factor is 107%"). Undefined and to be ignored when `noPls` is true. */
  readonly scalePercent: number;
  /** iFitWidth: how many pages wide the sheet is fitted to. 0 is [MS-XLS]'s own "use as many pages as necessary". Meaningful only when WsBool's fFitToPage is set. */
  readonly fitWidth: number;
  /** iFitHeight: the same for the sheet's height. */
  readonly fitHeight: number;
  /** fLeftToRight: pages printed left-to-right first (true) or top-to-bottom first (false). */
  readonly leftToRight: boolean;
  /** fPortrait. Undefined and to be ignored when `noPls` or `noOrientation` is true — in the latter case [MS-XLS] states the sheet prints portrait regardless. */
  readonly portrait: boolean;
  /** fNoPls: the paper size, scale, resolution, copy count, and both orientation bits are undefined. */
  readonly noPls: boolean;
  /** fNoOrient: "whether the paper orientation is set" — when true, fPortrait is undefined and "Pages are printed using portrait mode". */
  readonly noOrientation: boolean;
}

/** Packs a SetupFields' own four flags back into the record's grbit word. Every bit this package does not model is written as zero, which is what [MS-XLS] 2.4.257's own reserved field requires and what its remaining optional behaviours (black-and-white, draft quality, comment printing, error rendering, a custom starting page number) default to. */
export function packSetupFlags(fields: SetupFields): number {
  return (
    (fields.leftToRight ? SETUP_FLAG_LEFT_TO_RIGHT : 0) |
    (fields.portrait ? SETUP_FLAG_PORTRAIT : 0) |
    (fields.noPls ? SETUP_FLAG_NO_PLS : 0) |
    (fields.noOrientation ? SETUP_FLAG_NO_ORIENT : 0)
  );
}

/** The read-side inverse of packSetupFlags: the four flags this package acts on, taken out of the record's grbit word. */
export function unpackSetupFlags(grbit: number): {
  leftToRight: boolean;
  portrait: boolean;
  noPls: boolean;
  noOrientation: boolean;
} {
  return {
    leftToRight: (grbit & SETUP_FLAG_LEFT_TO_RIGHT) !== 0,
    portrait: (grbit & SETUP_FLAG_PORTRAIT) !== 0,
    noPls: (grbit & SETUP_FLAG_NO_PLS) !== 0,
    noOrientation: (grbit & SETUP_FLAG_NO_ORIENT) !== 0,
  };
}

/**
 * Setup.iPaperSize's own code table ([MS-XLS] 2.4.257), restricted to the codes whose entry states a real, unambiguous sheet size in inches or millimetres, and with each size derived from those stated dimensions rather than from a table of pre-converted points.
 *
 * The full enumeration runs to 118 entries, most of them envelopes, rotated variants, and regional stationery sizes; the ones here are the office paper sizes a spreadsheet is realistically printed on, entered exactly as [MS-XLS]'s own table names them. A code outside this table — including 0 and everything at 256 or above, which the spec reserves for "custom printer paper sizes" no reader can resolve without the printer's own Pls record — resolves to no page size at all, and content.ts falls back to its documented default rather than guessing a size the file never stated.
 */
// [MS-XLS] 2.4.257's own iPaperSize codes for the entries PAPER_SIZE_BY_CODE below states, named exactly as that table names each one.
const PAPER_US_LETTER = 1;
const PAPER_US_LETTER_SMALL = 2;
const PAPER_US_TABLOID = 3;
const PAPER_US_LEDGER = 4;
const PAPER_US_LEGAL = 5;
const PAPER_US_STATEMENT = 6;
const PAPER_US_EXECUTIVE = 7;
const PAPER_A3 = 8;
const PAPER_A4 = 9;
const PAPER_A4_SMALL = 10;
const PAPER_A5 = 11;
const PAPER_B4_JIS = 12;
const PAPER_B5_JIS = 13;
const PAPER_FOLIO = 14;
const PAPER_QUARTO = 15;
const PAPER_10X14 = 16;
const PAPER_11X17 = 17;
const PAPER_US_NOTE = 18;
const PAPER_B4_ISO = 42;
const PAPER_A2 = 66;
const PAPER_A6 = 70;

const PAPER_SIZE_BY_CODE: ReadonlyMap<number, PageSize> = new Map<
  number,
  PageSize
>([
  [PAPER_US_LETTER, inchPaper("8.5x11")], // US Letter 8 1/2 x 11 in
  [PAPER_US_LETTER_SMALL, inchPaper("8.5x11")], // US Letter Small 8 1/2 x 11 in
  [PAPER_US_TABLOID, inchPaper("11x17")], // US Tabloid 11 x 17 in
  [PAPER_US_LEDGER, inchPaper("17x11")], // US Ledger 17 x 11 in
  [PAPER_US_LEGAL, inchPaper("8.5x14")], // US Legal 8 1/2 x 14 in
  [PAPER_US_STATEMENT, inchPaper("5.5x8.5")], // US Statement 5 1/2 x 8 1/2 in
  [PAPER_US_EXECUTIVE, inchPaper("7.25x10.5")], // US Executive 7 1/4 x 10 1/2 in
  [PAPER_A3, millimetrePaper("297x420")], // A3 297 x 420 mm
  [PAPER_A4, millimetrePaper("210x297")], // A4 210 x 297 mm
  [PAPER_A4_SMALL, millimetrePaper("210x297")], // A4 Small 210 x 297 mm
  [PAPER_A5, millimetrePaper("148x210")], // A5 148 x 210 mm
  [PAPER_B4_JIS, millimetrePaper("250x354")], // B4 (JIS) 250 x 354
  [PAPER_B5_JIS, millimetrePaper("182x257")], // B5 (JIS) 182 x 257 mm
  [PAPER_FOLIO, inchPaper("8.5x13")], // Folio 8 1/2 x 13 in
  [PAPER_QUARTO, millimetrePaper("215x275")], // Quarto 215 x 275 mm
  [PAPER_10X14, inchPaper("10x14")], // 10 x 14 in
  [PAPER_11X17, inchPaper("11x17")], // 11 x 17 in
  [PAPER_US_NOTE, inchPaper("8.5x11")], // US Note 8 1/2 x 11 in
  [PAPER_B4_ISO, millimetrePaper("250x353")], // B4 (ISO) 250 x 353 mm
  [PAPER_A2, millimetrePaper("420x594")], // A2 420 x 594 mm
  [PAPER_A6, millimetrePaper("105x148")], // A6 105 x 148 mm
]);

/**
 * The page size a Setup record's own iPaperSize and orientation flags describe, or undefined when the code is not one this package maps.
 *
 * A paper code names the sheet's paper in its PORTRAIT dimensions regardless of how the sheet actually prints, so the orientation flags decide whether those dimensions are used as-is or transposed. [MS-XLS] 2.4.257 defines that in two steps: fNoOrient set means "Pages are printed using portrait mode" outright, and only when it is clear does fPortrait itself select portrait (1) or landscape (0).
 */
export function pageSizeFromSetup(fields: SetupFields): PageSize | undefined {
  const portraitSize = PAPER_SIZE_BY_CODE.get(fields.paperCode);
  if (portraitSize === undefined) {
    return undefined;
  }
  const printsPortrait = fields.noOrientation || fields.portrait;
  return printsPortrait
    ? portraitSize
    : { widthPt: portraitSize.heightPt, heightPt: portraitSize.widthPt };
}

/** How close two page dimensions must be, in points, to count as the same paper. Half a point is about 0.18mm — far below any real paper-size difference, and wide enough to absorb the hundredth-of-a-point rounding the table below applies and the unit conversions a page size picks up crossing between codecs. The same tolerance ooxml.js's own pageSizeToPaperSizeCode uses for the identical decision on xlsx's paperSize attribute. */
const PAPER_SIZE_TOLERANCE_PT = 0.5;

/** How a Setup record can name a given page size: the paper code, and whether the sheet must be declared portrait or landscape for that code's own portrait dimensions to come out as the size asked for. */
export interface PaperSelection {
  readonly code: number;
  readonly portrait: boolean;
}

/**
 * The write-side inverse of pageSizeFromSetup: the paper code and orientation whose resolved page size matches this one, or undefined when no code in the table does.
 *
 * Undefined is a real answer with no fallback behind it. Unlike xlsx's own pageSetup element, which can state an explicit paperWidth/paperHeight pair when no code fits, [MS-XLS] 2.4.257's Setup record addresses paper only by code — its own escape hatch for a size outside the table is a printer-defined custom size carried in a separate Pls record ([MS-XLS] 2.4.199), a printer driver's opaque DEVMODE blob rather than a pair of dimensions any reader could recover the size from. So a page size no code names genuinely cannot be written; the caller refuses rather than silently substituting a paper the document never asked for.
 *
 * A portrait match is preferred over a landscape one wherever both exist, which is what keeps the choice deterministic for the handful of codes in the table that are each other's transpose (US Tabloid 11x17in and US Ledger 17x11in are the same sheet of paper entered twice, once each way round).
 */
export function paperSelectionFor(
  pageSize: Readonly<PageSize>,
): PaperSelection | undefined {
  for (const [code, paper] of PAPER_SIZE_BY_CODE) {
    if (
      matches(pageSize.widthPt, paper.widthPt) &&
      matches(pageSize.heightPt, paper.heightPt)
    ) {
      return { code, portrait: true };
    }
  }
  for (const [code, paper] of PAPER_SIZE_BY_CODE) {
    if (
      matches(pageSize.widthPt, paper.heightPt) &&
      matches(pageSize.heightPt, paper.widthPt)
    ) {
      return { code, portrait: false };
    }
  }
  return undefined;
}

function matches(a: number, b: number): boolean {
  return Math.abs(a - b) <= PAPER_SIZE_TOLERANCE_PT;
}

/** Rounded to hundredths of a point, which is how document-schema.js spells its own PAGE_SIZE_A4 (595.28 x 841.89 pt, the same 210 x 297 mm converted the same way). Rounding here rather than carrying the full conversion is what makes a code-9 page size read out of a real file EQUAL that shared constant instead of merely being within a rounding error of it. */
function roundToHundredths(value: number): number {
  return (
    Math.round(value * HUNDREDTHS_ROUNDING_FACTOR) / HUNDREDTHS_ROUNDING_FACTOR
  );
}

/** A "WIDTHxHEIGHT" pair, in the paper table's own unit — a single literal per table entry, rather than two, so PAPER_SIZE_BY_CODE states each size the same compact way [MS-XLS] 2.4.257's own comment column does ("8 1/2 x 11 in"). */
type Dimensions = `${number}x${number}`;

function parseDimensions(dimensions: Dimensions): readonly [number, number] {
  const [width, height] = dimensions.split("x");
  if (width === undefined || height === undefined) {
    throw new Error(`invalid paper dimensions: ${dimensions}`);
  }
  return [Number(width), Number(height)];
}

function inchPaper(dimensions: Dimensions): PageSize {
  const [widthIn, heightIn] = parseDimensions(dimensions);
  return {
    widthPt: roundToHundredths(inchesToPoints(widthIn)),
    heightPt: roundToHundredths(inchesToPoints(heightIn)),
  };
}

function millimetrePaper(dimensions: Dimensions): PageSize {
  const [widthMm, heightMm] = parseDimensions(dimensions);
  return {
    widthPt: roundToHundredths(millimetresToPoints(widthMm)),
    heightPt: roundToHundredths(millimetresToPoints(heightMm)),
  };
}
