import {
  hasSummaryInformationFields,
  writeCompoundFile,
  writeSummaryInformationStream,
} from "archive-codec";
import type {
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
  DocumentTree,
} from "document-schema.js";
import { flattenTree } from "document-schema.js";

import { BUILTIN_NUMBER_FORMATS } from "excel-number-format";

import { BiffWriteError } from "./biff/write-errors";
import type { XlsContentDocument } from "./content";
import { SUMMARY_INFORMATION_STREAM } from "./container";
import { layoutMetadataToSummaryInformation } from "./metadata";
import {
  buildWorkbookGlobals,
  GENERAL_CELL_XF_INDEX,
  type WorkbookGlobalsPlan,
} from "./workbook/globals-writer";
import {
  buildWorksheetSubstream,
  type SheetWriteContext,
} from "./workbook/sheet-writer";

// The BIFF8 write path: a ContentDocument (or DocumentTree) of kind 'spreadsheet' back to real .xls bytes -- a genuine [MS-XLS] Workbook stream wrapped in a genuine [MS-CFB] compound file via archive-codec's writeCompoundFile. The counterpart of content.ts's readXlsContent/readXls, and of ooxml.js's own writeXlsx.
//
// Two things are workbook-wide rather than per-sheet, so they are resolved in one pass over every sheet before any record is written: the number-format table (a cell's own numberFormatCode, or a representative default for its value kind when absent, maps onto a shared BIFF8 format identifier and XF index the same code reuses everywhere it appears) and the shared string table (every distinct string value, in first-encountered order, referenced by index from a LabelSst cell in any sheet). Building each once and threading the result into every sheet's own writer is what keeps two cells in different sheets sharing the identical string or format from minting two redundant table entries.
//
// See this package's README for the writer's own scope: what it covers (numeric/percentage/currency/date/time/dateTime/boolean/error/string cell values, merged ranges, row heights, column widths, custom and built-in number formats) and what it deliberately does not (formulas, cell decoration, images, comments, data validation, conditional formatting, print settings, and a long tail of BIFF8 records that carry UI/interoperability state rather than document content).

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
  readonly cellXfFormatIds: readonly number[];
  readonly formatIdOf: (code: string) => number;
  readonly xfIndexOf: (formatId: number) => number;
}

/** Scans every sheet's cells once, assigning each distinct number-format code a formatId (reusing a built-in id for a code matching one of excel-number-format's own BUILTIN_NUMBER_FORMATS strings exactly, minting a new custom id from FIRST_CUSTOM_FORMAT_ID otherwise) and each distinct formatId a cell XF index (formatId 0 always resolves to GENERAL_CELL_XF_INDEX, the workbook's own unconditional "General" cell format). */
function buildFormatPlan(sheets: readonly ContentSheet[]): FormatPlan {
  const codeToFormatId = new Map<string, number>();
  const builtinIdByCode = new Map<string, number>(
    Array.from(BUILTIN_NUMBER_FORMATS, ([id, code]) => [code, id]),
  );
  const customFormats: { id: number; code: string }[] = [];
  const cellXfFormatIds: number[] = [];
  const formatIdToXfIndex = new Map<number, number>([
    [GENERAL_FORMAT_ID, GENERAL_CELL_XF_INDEX],
  ]);
  let nextCustomId = FIRST_CUSTOM_FORMAT_ID;
  let nextXfIndex = GENERAL_CELL_XF_INDEX + 1;

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
    if (!formatIdToXfIndex.has(formatId)) {
      formatIdToXfIndex.set(formatId, nextXfIndex);
      cellXfFormatIds.push(formatId);
      nextXfIndex += 1;
    }
    return formatId;
  };

  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      if (cell.value.kind === "empty") {
        continue;
      }
      resolve(formatCodeForCell(cell));
    }
  }

  return {
    customFormats,
    cellXfFormatIds,
    formatIdOf: (code: string): number => {
      const id = codeToFormatId.get(code);
      if (id === undefined) {
        throw new BiffWriteError(
          `internal error: number-format code ${JSON.stringify(code)} was not registered during the workbook-wide format scan`,
        );
      }
      return id;
    },
    xfIndexOf: (formatId: number): number => {
      const index = formatIdToXfIndex.get(formatId);
      if (index === undefined) {
        throw new BiffWriteError(
          `internal error: formatId ${formatId} was not assigned a cell XF index during the workbook-wide format scan`,
        );
      }
      return index;
    },
  };
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

  const globalsPlan: WorkbookGlobalsPlan = {
    sheetNames: content.sheets.map((sheet) => sheet.name),
    customFormats: formatPlan.customFormats,
    cellXfFormatIds: formatPlan.cellXfFormatIds,
    sharedStrings: sstPlan.strings,
    sharedStringTotalCount: sstPlan.totalCount,
  };
  const globals = buildWorkbookGlobals(globalsPlan);

  const sheetContext: SheetWriteContext = {
    formatIdForCell: (cell) => formatPlan.formatIdOf(formatCodeForCell(cell)),
    xfIndexForFormatId: (formatId) => formatPlan.xfIndexOf(formatId),
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
