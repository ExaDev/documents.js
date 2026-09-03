import {
  hasSummaryInformationFields,
  writeCompoundFile,
  writeSummaryInformationStream,
} from "archive-codec";
import type {
  Color,
  ContentBorder,
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
  DocumentTree,
} from "document-schema.js";
import { colorToRgbHex, flattenTree } from "document-schema.js";

import { BUILTIN_NUMBER_FORMATS } from "excel-number-format";

import { BiffWriteError } from "./biff/write-errors";
import {
  BORDER_STYLE_NONE,
  borderStyleTokenFor,
  DEFAULT_PALETTE_HEX_TO_ICV,
  FILL_PATTERN_NONE,
  FILL_PATTERN_SOLID,
  ICV_AUTOMATIC_FOREGROUND,
  PALETTE_BASE_ICV,
  PALETTE_ENTRY_COUNT,
  type XfBorderEdge,
  type XfDecorationFields,
} from "./biff/xf-colors";
import type { XlsContentDocument } from "./content";
import { SUMMARY_INFORMATION_STREAM } from "./container";
import { layoutMetadataToSummaryInformation } from "./metadata";
import {
  buildWorkbookGlobals,
  GENERAL_CELL_XF_INDEX,
  type CellXfPlanEntry,
  type WorkbookGlobalsPlan,
} from "./workbook/globals-writer";
import {
  buildWorksheetSubstream,
  type SheetWriteContext,
} from "./workbook/sheet-writer";
import { writesCellRecord } from "./written-cells";

// The BIFF8 write path: a ContentDocument (or DocumentTree) of kind 'spreadsheet' back to real .xls bytes -- a genuine [MS-XLS] Workbook stream wrapped in a genuine [MS-CFB] compound file via archive-codec's writeCompoundFile. The counterpart of content.ts's readXlsContent/readXls, and of ooxml.js's own writeXlsx.
//
// Three things are workbook-wide rather than per-sheet, so they are resolved in one pass over every sheet before any record is written: the number-format table (a cell's own numberFormatCode, or a representative default for its value kind when absent, maps onto a shared BIFF8 format identifier the same code reuses everywhere it appears), the colour table (every distinct background/border colour a cell uses, resolved to an icv against the fixed default palette or, when a colour genuinely isn't in it, a real Palette record this pass mints), and the shared string table (every distinct string value, in first-encountered order, referenced by index from a LabelSst cell in any sheet). A fourth pass, buildCellXfPlan, then interns the (number format, decoration) PAIR every cell resolves to into its own cell XF index -- two cells sharing both a format and a decoration share one XF record, mirroring how ooxml.js's own CellFormatTable dedupes an xlsx <xf> on the identical pair. Building each of these once and threading the result into every sheet's own writer is what keeps two cells in different sheets sharing the identical string, format, or decoration from minting redundant table entries.
//
// See this package's README for the writer's own scope: what it covers (numeric/percentage/currency/date/time/dateTime/boolean/error/string cell values, merged ranges, row heights, column widths, custom and built-in number formats, and now cell background fill and per-side borders) and what it deliberately does not (formulas, alignment, per-cell fonts, images, comments, data validation, conditional formatting, print settings, and a long tail of BIFF8 records that carry UI/interoperability state rather than document content).

const WORKBOOK_STREAM_NAME = "Workbook";

/** [MS-XLS] 2.4.126: a Format record's own ifmt is constrained to the ranges 5-8, 23-26, 41-44, 63-66, and 164-382 for a custom (non-built-in) code; 164 is the first identifier every real producer actually uses for a custom code, and this writer follows suit, incrementing sequentially and refusing to exceed the range's own ceiling. */
const FIRST_CUSTOM_FORMAT_ID = 164;
const LAST_CUSTOM_FORMAT_ID = 382;

const BUILTIN_FORMAT_PERCENTAGE = 9; // "0%"
const BUILTIN_FORMAT_CURRENCY = 44; // '_("$"* #,##0.00_);_("$"* \(#,##0.00\);_("$"* "-"??_);_(@_)'
const BUILTIN_FORMAT_DATE = 14; // "mm-dd-yy"
const BUILTIN_FORMAT_TIME = 21; // "h:mm:ss"
const BUILTIN_FORMAT_DATE_TIME = 22; // "m/d/yy h:mm"
const GENERAL_FORMAT_ID = 0;

function builtinCode(id: number): string {
  const code = BUILTIN_NUMBER_FORMATS.get(id);
  if (code === undefined) {
    throw new BiffWriteError(
      `internal error: BUILTIN_NUMBER_FORMATS has no entry for id ${id}`,
    );
  }
  return code;
}

/** The default format identifier a value kind resolves to when its own cell carries no numberFormatCode -- chosen so excel-number-format's classifyNumberFormat, run against the resulting code on the way back in, reclassifies to the identical kind. A plain number/string/boolean/error needs no distinguishing code at all: General classifies as 'number', which is exactly the fallback content.ts's own resolveValue already takes for a numeric cell with no format. */
function defaultFormatIdForKind(
  kind: ContentSheetCell["value"]["kind"],
): number {
  switch (kind) {
    case "percentage":
      return BUILTIN_FORMAT_PERCENTAGE;
    case "currency":
      return BUILTIN_FORMAT_CURRENCY;
    case "date":
      return BUILTIN_FORMAT_DATE;
    case "time":
      return BUILTIN_FORMAT_TIME;
    case "dateTime":
      return BUILTIN_FORMAT_DATE_TIME;
    case "number":
    case "string":
    case "boolean":
    case "error":
    case "empty":
      return GENERAL_FORMAT_ID;
  }
}

/** The number-format code a cell resolves through -- its own explicit numberFormatCode, or the built-in code for its value kind's own default identifier. This is called identically during the workbook-wide format scan and later per cell, so the two can never resolve a cell to different codes. */
function formatCodeForCell(cell: ContentSheetCell): string {
  return (
    cell.numberFormatCode ??
    builtinCode(defaultFormatIdForKind(cell.value.kind))
  );
}

interface FormatPlan {
  readonly customFormats: readonly {
    readonly id: number;
    readonly code: string;
  }[];
  readonly formatIdOf: (code: string) => number;
}

/** Scans every sheet's cells once, assigning each distinct number-format code a formatId: reusing a built-in id for a code matching one of excel-number-format's own BUILTIN_NUMBER_FORMATS strings exactly, minting a new custom id from FIRST_CUSTOM_FORMAT_ID otherwise. Cell XF index assignment is a separate, later pass (buildCellXfPlan below) -- a formatId alone no longer determines a cell's XF index once decoration exists, since two cells sharing a format but differing in background/borders need two distinct XFs. */
function buildFormatPlan(sheets: readonly ContentSheet[]): FormatPlan {
  const codeToFormatId = new Map<string, number>();
  const builtinIdByCode = new Map<string, number>(
    Array.from(BUILTIN_NUMBER_FORMATS, ([id, code]) => [code, id]),
  );
  const customFormats: { id: number; code: string }[] = [];
  let nextCustomId = FIRST_CUSTOM_FORMAT_ID;

  const resolve = (code: string): number => {
    const existing = codeToFormatId.get(code);
    if (existing !== undefined) {
      return existing;
    }
    const builtinId = builtinIdByCode.get(code);
    let formatId: number;
    if (builtinId !== undefined) {
      formatId = builtinId;
    } else {
      if (nextCustomId > LAST_CUSTOM_FORMAT_ID) {
        throw new BiffWriteError(
          `workbook needs more than ${LAST_CUSTOM_FORMAT_ID - FIRST_CUSTOM_FORMAT_ID + 1} distinct custom number formats, more than [MS-XLS] 2.4.126's own ${FIRST_CUSTOM_FORMAT_ID}-${LAST_CUSTOM_FORMAT_ID} custom-identifier range allows`,
        );
      }
      formatId = nextCustomId;
      nextCustomId += 1;
      customFormats.push({ id: formatId, code });
    }
    codeToFormatId.set(code, formatId);
    return formatId;
  };

  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      if (!writesCellRecord(cell)) {
        continue;
      }
      resolve(formatCodeForCell(cell));
    }
  }

  return {
    customFormats,
    formatIdOf: (code: string): number => {
      const id = codeToFormatId.get(code);
      if (id === undefined) {
        throw new BiffWriteError(
          `internal error: number-format code ${JSON.stringify(code)} was not registered during the workbook-wide format scan`,
        );
      }
      return id;
    },
  };
}

// --- Cell decoration: the workbook-wide colour table, and the (format, decoration) -> XF-index interning that carries it ---

interface PalettePlan {
  /** The workbook's own custom colour table (56 entries, icv 8 first), or undefined when every distinct decoration colour the workbook's cells use already matches the fixed default table -- in which case no Palette record is needed at all, and icvOf resolves every colour straight through that default table. */
  readonly paletteColors: readonly Color[] | undefined;
  /** The icv (7-bit colour-table index) a decoration colour resolves to -- into `paletteColors` when defined, into the fixed default table otherwise. Every colour this is called with must already have been registered during the workbook-wide colour scan below. */
  readonly icvOf: (color: Color) => number;
}

/** Scans every sheet's cells once for the distinct fill/border colours the workbook actually uses (background, and each present border side's own colour), then decides whether they all already have a home in the fixed default table (no Palette record needed) or whether at least one genuinely custom colour forces a real one -- in which case every distinct colour, not just the non-default ones, is allocated its own dedicated slot, so the whole 56-entry table is self-consistent and every reference resolves through it rather than a mix of "the file's own table" and "the implicit default". */
function buildPalettePlan(sheets: readonly ContentSheet[]): PalettePlan {
  const colorByHex = new Map<string, Color>();
  const record = (color: Color | undefined): void => {
    if (color === undefined) {
      return;
    }
    const hex = colorToRgbHex(color);
    if (!colorByHex.has(hex)) {
      colorByHex.set(hex, color);
    }
  };
  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      // Only cells that actually become records, so the scan can never allocate a palette slot to a colour the XF pass below then never writes -- see written-cells.ts on why every pass shares one predicate.
      if (!writesCellRecord(cell)) {
        continue;
      }
      record(cell.background);
      record(cell.borders?.left?.color);
      record(cell.borders?.right?.color);
      record(cell.borders?.top?.color);
      record(cell.borders?.bottom?.color);
    }
  }

  const missing = (hex: string): never => {
    throw new BiffWriteError(
      `internal error: colour ${hex} was not registered during the workbook-wide palette scan`,
    );
  };

  if (colorByHex.size === 0) {
    return {
      paletteColors: undefined,
      icvOf: (color) => missing(colorToRgbHex(color)),
    };
  }

  // Fast path: does every distinct colour already match the fixed default table exactly? If so, no Palette record is needed at all.
  const defaultIcvByHex = new Map<string, number>();
  let needsCustomPalette = false;
  for (const hex of colorByHex.keys()) {
    const icv = DEFAULT_PALETTE_HEX_TO_ICV.get(hex);
    if (icv === undefined) {
      needsCustomPalette = true;
      break;
    }
    defaultIcvByHex.set(hex, icv);
  }
  if (!needsCustomPalette) {
    return {
      paletteColors: undefined,
      icvOf: (color) =>
        defaultIcvByHex.get(colorToRgbHex(color)) ??
        missing(colorToRgbHex(color)),
    };
  }

  // Slow path: at least one colour needs a genuinely custom entry. Allocate every distinct colour -- not just the non-default ones -- into fresh slots in first-use order, so the record this writes is fully self-consistent.
  if (colorByHex.size > PALETTE_ENTRY_COUNT) {
    throw new BiffWriteError(
      `workbook needs ${colorByHex.size} distinct decoration colours, more than the ${PALETTE_ENTRY_COUNT} entries [MS-XLS] 2.4.204's own Palette record can hold`,
    );
  }
  const icvByHex = new Map<string, number>();
  const paletteColors: Color[] = [];
  let nextIcv = PALETTE_BASE_ICV;
  for (const [hex, color] of colorByHex) {
    icvByHex.set(hex, nextIcv);
    paletteColors.push(color);
    nextIcv += 1;
  }
  // Unused trailing slots are never referenced by any XF this writer emits -- their exact content is immaterial, and black is as good a filler as any -- but the record still declares the full, spec-required 56 entries rather than a short one.
  while (paletteColors.length < PALETTE_ENTRY_COUNT) {
    paletteColors.push({ r: 0, g: 0, b: 0 });
  }

  return {
    paletteColors,
    icvOf: (color) =>
      icvByHex.get(colorToRgbHex(color)) ?? missing(colorToRgbHex(color)),
  };
}

const UNDECORATED_EDGE: XfBorderEdge = { style: BORDER_STYLE_NONE, icv: 0 };

function resolveWriteEdge(
  border: ContentBorder | undefined,
  icvOf: (color: Color) => number,
): XfBorderEdge {
  if (border === undefined) {
    return UNDECORATED_EDGE;
  }
  return { style: borderStyleTokenFor(border), icv: icvOf(border.color) };
}

/** A cell's own decoration, resolved into the raw XfDecorationFields the CellXF payload packs -- undefined for a cell with neither a background nor any border, so it shares the workbook's plain undecorated XF exactly as it did before decoration existed. */
function resolveDecorationForCell(
  cell: ContentSheetCell,
  icvOf: (color: Color) => number,
): XfDecorationFields | undefined {
  if (cell.background === undefined && cell.borders === undefined) {
    return undefined;
  }
  return {
    fillPattern:
      cell.background === undefined ? FILL_PATTERN_NONE : FILL_PATTERN_SOLID,
    fillForegroundIcv:
      cell.background === undefined
        ? ICV_AUTOMATIC_FOREGROUND
        : icvOf(cell.background),
    left: resolveWriteEdge(cell.borders?.left, icvOf),
    right: resolveWriteEdge(cell.borders?.right, icvOf),
    top: resolveWriteEdge(cell.borders?.top, icvOf),
    bottom: resolveWriteEdge(cell.borders?.bottom, icvOf),
  };
}

/** A deterministic signature for one cell XF's own (formatId, decoration) pair, so two cells sharing both share one XF record -- the interning key buildCellXfPlan below dedupes on, mirroring how CellFormatTable in ooxml.js's typed/xlsx/styles.ts dedupes an <xf> on (number format, decoration) together rather than on format alone. */
function signatureOfCellXf(
  formatId: number,
  decoration: XfDecorationFields | undefined,
): string {
  if (decoration === undefined) {
    return `f${formatId}`;
  }
  return (
    `f${formatId}` +
    `|p${decoration.fillPattern}:${decoration.fillForegroundIcv}` +
    `|l${decoration.left.style}:${decoration.left.icv}` +
    `|r${decoration.right.style}:${decoration.right.icv}` +
    `|t${decoration.top.style}:${decoration.top.icv}` +
    `|b${decoration.bottom.style}:${decoration.bottom.icv}`
  );
}

interface CellXfPlan {
  readonly cellXfEntries: readonly CellXfPlanEntry[];
  readonly xfIndexForCell: (cell: ContentSheetCell) => number;
}

/** Scans every sheet's cells once, interning each distinct (number format, decoration) combination into its own cell XF index -- a cell with General formatting and no decoration resolves to the workbook's own implicit GENERAL_CELL_XF_INDEX with no new XF record at all, exactly as before; every other combination mints one XF record the first time it is seen and is reused by every later cell sharing it. */
function buildCellXfPlan(
  sheets: readonly ContentSheet[],
  formatPlan: FormatPlan,
  palettePlan: PalettePlan,
): CellXfPlan {
  const cellXfEntries: CellXfPlanEntry[] = [];
  const xfIndexBySignature = new Map<string, number>([
    [signatureOfCellXf(GENERAL_FORMAT_ID, undefined), GENERAL_CELL_XF_INDEX],
  ]);
  let nextXfIndex = GENERAL_CELL_XF_INDEX + 1;

  const xfIndexForCell = (cell: ContentSheetCell): number => {
    const formatId = formatPlan.formatIdOf(formatCodeForCell(cell));
    const decoration = resolveDecorationForCell(cell, palettePlan.icvOf);
    const signature = signatureOfCellXf(formatId, decoration);
    const existing = xfIndexBySignature.get(signature);
    if (existing !== undefined) {
      return existing;
    }
    const index = nextXfIndex;
    nextXfIndex += 1;
    cellXfEntries.push({ formatId, decoration });
    xfIndexBySignature.set(signature, index);
    return index;
  };

  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      if (!writesCellRecord(cell)) {
        continue;
      }
      xfIndexForCell(cell);
    }
  }

  return { cellXfEntries, xfIndexForCell };
}

interface SstPlan {
  readonly strings: readonly string[];
  readonly totalCount: number;
  readonly indexOf: (text: string) => number;
}

/** Scans every sheet's string-kind cells once, in sheet then cell order, assigning each distinct value the shared string table index every LabelSst cell referencing it uses. */
function buildSstPlan(sheets: readonly ContentSheet[]): SstPlan {
  const indexOf = new Map<string, number>();
  const strings: string[] = [];
  let totalCount = 0;
  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      if (cell.value.kind !== "string") {
        continue;
      }
      totalCount += 1;
      if (!indexOf.has(cell.value.value)) {
        indexOf.set(cell.value.value, strings.length);
        strings.push(cell.value.value);
      }
    }
  }
  return {
    strings,
    totalCount,
    indexOf: (text: string): number => {
      const index = indexOf.get(text);
      if (index === undefined) {
        throw new BiffWriteError(
          `internal error: string ${JSON.stringify(text)} was not registered during the workbook-wide shared-string scan`,
        );
      }
      return index;
    },
  };
}

/** Patches a BoundSheet8's own lbPlyPos field in place: a 4-byte little-endian integer at a byte offset globals-writer.ts already reported, once the real value -- where that sheet's own substream landed in the finished workbook stream -- is known. */
function patchBoundSheetOffsets(
  globalsBytes: Uint8Array<ArrayBuffer>,
  offsets: readonly number[],
  values: readonly number[],
): void {
  const view = new DataView(
    globalsBytes.buffer,
    globalsBytes.byteOffset,
    globalsBytes.byteLength,
  );
  offsets.forEach((offset, index) => {
    view.setUint32(offset, values[index] ?? 0, true);
  });
}

function concatBytes(
  parts: readonly Uint8Array<ArrayBuffer>[],
): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Builds the [MS-XLS] Workbook stream: the globals substream followed by one worksheet substream per sheet, with every BoundSheet8's own lbPlyPos patched to the real byte offset its sheet's substream landed at. */
function buildWorkbookStream(
  content: XlsContentDocument,
): Uint8Array<ArrayBuffer> {
  if (content.sheets.length === 0) {
    throw new BiffWriteError(
      "a .xls workbook must contain at least one sheet ([MS-XLS] 2.1.7.20.3's own BUNDLESHEET production requires 1*BoundSheet8), but the document being written has none",
    );
  }

  const formatPlan = buildFormatPlan(content.sheets);
  const sstPlan = buildSstPlan(content.sheets);
  const palettePlan = buildPalettePlan(content.sheets);
  const cellXfPlan = buildCellXfPlan(content.sheets, formatPlan, palettePlan);

  const globalsPlan: WorkbookGlobalsPlan = {
    sheetNames: content.sheets.map((sheet) => sheet.name),
    customFormats: formatPlan.customFormats,
    cellXfEntries: cellXfPlan.cellXfEntries,
    sharedStrings: sstPlan.strings,
    sharedStringTotalCount: sstPlan.totalCount,
    paletteColors: palettePlan.paletteColors,
  };
  const globals = buildWorkbookGlobals(globalsPlan);

  const sheetContext: SheetWriteContext = {
    xfIndexForCell: cellXfPlan.xfIndexForCell,
    sstIndexFor: (text) => sstPlan.indexOf(text),
  };

  const sheetStreams = content.sheets.map((sheet) =>
    buildWorksheetSubstream(sheet, sheetContext),
  );

  const sheetOffsets: number[] = [];
  let offset = globals.bytes.length;
  for (const stream of sheetStreams) {
    sheetOffsets.push(offset);
    offset += stream.length;
  }

  const globalsBytes = globals.bytes.slice();
  patchBoundSheetOffsets(globalsBytes, globals.lbPlyPosOffsets, sheetOffsets);

  return concatBytes([globalsBytes, ...sheetStreams]);
}

/**
 * Writes a spreadsheet ContentDocument to real .xls bytes: a BIFF8 Workbook stream wrapped in an [MS-CFB] compound file.
 *
 * The counterpart of content.ts's readXlsContent. See this package's README for the writer's full scope.
 */
export function writeXlsContent(
  content: XlsContentDocument,
): Uint8Array<ArrayBuffer> {
  const stream = buildWorkbookStream(content);
  const streams = [{ path: WORKBOOK_STREAM_NAME, bytes: stream }];
  // Only when there is something SummaryInformation can actually hold: an input whose metadata carries nothing beyond creator/producer/language (or nothing at all) should read back exactly as it would with no stream present, not force an empty-but-present one into existence.
  if (hasSummaryInformationFields(content.metadata)) {
    streams.push({
      path: SUMMARY_INFORMATION_STREAM,
      bytes: writeSummaryInformationStream(
        layoutMetadataToSummaryInformation(content.metadata),
      ),
    });
  }
  return writeCompoundFile(streams);
}

/** Writes a DocumentTree of kind 'spreadsheet' to real .xls bytes, flattening it to a ContentDocument first -- the counterpart of content.ts's readXls. */
export function writeXls(tree: DocumentTree): Uint8Array<ArrayBuffer> {
  const content: ContentDocument = flattenTree(tree);
  if (content.kind !== "spreadsheet") {
    throw new BiffWriteError(
      `writeXls was given a DocumentTree of kind '${content.kind}', but a .xls workbook can only be written from a 'spreadsheet' document`,
    );
  }
  return writeXlsContent(content);
}
