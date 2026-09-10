import {
  readSummaryInformation,
  summaryInformationToLayoutMetadata,
} from "archive-codec";
import type {
  Alignment,
  Color,
  ContentCellBorders,
  ContentCellFill,
  ContentCellValue,
  ContentDefinedName,
  ContentDocument,
  ContentFont,
  ContentSheet,
  ContentSheetCell,
  ContentSheetColumn,
  ContentSheetConditionalFormat,
  ContentSheetConditionalFormatStyle,
  ContentSheetConditionalFormatValue,
  ContentSheetDataValidation,
  ContentSheetPrintSettings,
  ContentSheetRow,
  DocumentTree,
  LayoutMetadata,
} from "document-schema.js";
import { assembleTree, PAGE_SIZE_LETTER } from "document-schema.js";

import { pageSizeFromSetup } from "./biff/print-setup";
import { contentFontOf, resolveFontColor } from "./biff/font";
import {
  BOF_TYPE_WORKSHEET,
  RECORD_FILEPASS,
  RECORD_MSODRAWINGGROUP,
} from "./biff/record-types";
import { BiffFormatError, readRecords } from "./biff/records";
import {
  groupRecords,
  splitSubstreams,
  type Substream,
} from "./biff/substreams";
import {
  applyTint,
  resolveFillBackground,
  resolveBorderEdge,
  resolveIcvColor,
} from "./biff/xf-colors";
import { readWorkbookStreams } from "./container";
import { readBlipStore, type BlipImage } from "./drawing/blips";
import { concatBytes } from "./drawing/bytes";
import { readSheetComments, type SheetCellComment } from "./workbook/comments";
import { readDefinedNames } from "./workbook/defined-names";
import { readSheetDrawing } from "./workbook/drawing";
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
import type { RawDataValidation } from "./workbook/data-validation";
import { decryptWorkbookRecords } from "./workbook/encryption";
import type {
  RawConditionalFormat,
  RawConditionalFormatStyle,
} from "./workbook/conditional-format";
import type {
  RawCfColor,
  RawColorScaleFormat,
  RawConditionalFormat12,
} from "./workbook/conditional-format-12";
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
 * The iScale value that says "print at actual size", which is what ContentSheetPrintSettings already means by carrying no scalePercent at all.
 *
 * Setup's own iScale is a mandatory field of a mandatory record, with no spelling for "this sheet declares no scale" -- so an untouched sheet still states 100. Reporting that as an explicit scalePercent would put a field on every sheet of every workbook read, carrying nothing a consumer could act on that its absence does not already say, and would mean a document written with no scale came back with one. The two spellings render identically, so collapsing them onto the absent one is lossless in both directions; a scale that is genuinely anything else is reported exactly as the file states it.
 */
const ACTUAL_SIZE_SCALE_PERCENT = 100;

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
  } else if (
    usable &&
    setup.scalePercent > 0 &&
    setup.scalePercent !== ACTUAL_SIZE_SCALE_PERCENT
  ) {
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
 * The counterpart of ooxml.js's readXlsxContent, producing the same shape from the older format. `password` decrypts a workbook protected by [MS-XLS] 2.4.117's FilePass record, under either the [MS-OFFCRYPTO] 2.3.6.1 RC4 encryption header scheme or 2.3.7's XOR obfuscation -- see workbook/encryption.ts. It is ignored for an unencrypted workbook, and a missing or incorrect password against an encrypted one throws rather than returning a partial or garbled document.
 */
export function readXlsContent(
  bytes: Uint8Array<ArrayBuffer>,
  password?: string,
): XlsContentDocument {
  const { workbook, metadata } = readWorkbookStreams(bytes);
  // FilePass ([MS-XLS] 2.4.117) is looked for in the raw record list, before grouping or substream-splitting, because its own record type and size are never encrypted ([MS-XLS] 2.2.10) -- readRecords already parses correctly over the still-encrypted stream, so there is no need for a separate raw byte scan.
  const rawRecords = readRecords(workbook);
  const filePassRecord = rawRecords.find(
    (record) => record.type === RECORD_FILEPASS,
  );
  const records =
    filePassRecord === undefined
      ? rawRecords
      : decryptWorkbookRecords(rawRecords, filePassRecord, password);
  const substreams = splitSubstreams(groupRecords(records));
  const globalsSubstream = substreams[0];
  if (globalsSubstream === undefined) {
    throw new BiffFormatError(
      "workbook stream holds no substreams, so it carries no globals substream",
    );
  }
  const globals = readWorkbookGlobals(globalsSubstream.records);
  // The Blip Store ([MS-ODRAW]'s own BstoreContainer) is workbook-wide, carried in the globals substream's own MsoDrawingGroup stream -- every worksheet's picture shapes reference it by index rather than each carrying its own copy. See drawing/blips.ts's own top comment.
  const blipStore = readBlipStore(
    concatDrawingGroupBytes(globalsSubstream.records),
  );
  // Absent when the container carries no "\x05SummaryInformation" stream at all -- a valid BIFF8 workbook need not have one -- and mapped from it through summaryInformationToLayoutMetadata (see src/metadata.ts) otherwise. Computed before the sheets, not after: a chart embedded in any sheet carries its own cached data as a small spreadsheet ContentDocument (see workbook/drawing.ts's own chartFromShape) that reuses this SAME document-level metadata, mirroring ooxml.js's own chart reading, which reuses the whole package's core properties for the identical synthetic sheet.
  const documentMetadata: LayoutMetadata =
    metadata === undefined
      ? {}
      : summaryInformationToLayoutMetadata(readSummaryInformation(metadata));
  // Indexed before filtering, not after: a print name's own itab is a position in the FULL BoundSheet8 collection, so a workbook whose first sheet is a chart would mis-key every print name if the index came from the filtered list.
  const worksheetEntries = globals.sheets
    .map((entry, sheetIndex) => ({ entry, sheetIndex }))
    .filter(({ entry }) => entry.sheetType === SHEET_TYPE_WORKSHEET);
  const sheets = worksheetEntries.map(({ entry, sheetIndex }) =>
    readSheet(
      entry,
      sheetIndex,
      substreams,
      globals,
      blipStore,
      documentMetadata,
    ),
  );
  return {
    kind: "spreadsheet",
    metadata: documentMetadata,
    sheets,
    ...mapDefinedNames(globalsSubstream.records, globals, worksheetEntries),
  };
}

/**
 * The document's own `names` array, from the workbook's Lbl records -- absent when the workbook declares no name this reader resolves, matching the schema's optional field.
 *
 * A name's Lbl-scoped sheetIndex is a position in the FULL BoundSheet8 collection, while ContentDefinedNameSchema's scopeSheetIndex names a position in the document's own (worksheet-only) sheets array, so each one is translated through the same filter the sheets themselves went through. A name scoped to a sheet that did not survive the filter -- a chart or macro sheet -- has no scope the schema can express, and is dropped whole rather than re-scoped to a neighbouring index or silently promoted to workbook-global: a wrong scope changes which sheet the name belongs to, not just how it is displayed.
 */
function mapDefinedNames(
  globalsRecords: Substream["records"],
  globals: WorkbookGlobals,
  worksheetEntries: readonly {
    readonly entry: SheetEntry;
    readonly sheetIndex: number;
  }[],
): { names?: ContentDefinedName[] } {
  const documentIndexOfSheet = new Map(
    worksheetEntries.map(({ sheetIndex }, documentIndex) => [
      sheetIndex,
      documentIndex,
    ]),
  );
  const names: ContentDefinedName[] = [];
  for (const raw of readDefinedNames(globalsRecords, {
    sheets: globals.sheets,
    sheetRanges: globals.sheetRanges,
  })) {
    if (raw.sheetIndex === undefined) {
      names.push({ name: raw.name, refersTo: raw.refersTo });
      continue;
    }
    const scopeSheetIndex = documentIndexOfSheet.get(raw.sheetIndex);
    if (scopeSheetIndex === undefined) {
      continue;
    }
    names.push({ name: raw.name, refersTo: raw.refersTo, scopeSheetIndex });
  }
  return names.length > 0 ? { names } : {};
}

/** Every MsoDrawingGroup record's own data, in stream order, concatenated into one Escher byte stream -- the workbook-wide counterpart of a worksheet's own MsoDrawing concatenation (drawing/shapes.ts's own readSheetShapes), carrying the Blip Store rather than any one sheet's shape tree. */
function concatDrawingGroupBytes(
  records: Substream["records"],
): Uint8Array<ArrayBuffer> {
  const chunks = records
    .filter((record) => record.type === RECORD_MSODRAWINGGROUP)
    .map((record) => record.blocks[0])
    .filter((block): block is Uint8Array<ArrayBuffer> => block !== undefined);
  return concatBytes(chunks);
}

/** The tree-form read: readXlsContent composed with the schema's own structural transform, exactly as ooxml.js's readXlsx wraps readXlsxContent. */
export function readXls(
  bytes: Uint8Array<ArrayBuffer>,
  password?: string,
): DocumentTree {
  return assembleTree(readXlsContent(bytes, password));
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
  blipStore: ReadonlyMap<number, BlipImage>,
  documentMetadata: LayoutMetadata,
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
  const formulaSheets = {
    sheets: globals.sheets,
    sheetRanges: globals.sheetRanges,
  };
  const raw: RawSheet =
    substream === undefined
      ? {
          cells: [],
          rows: [],
          columns: [],
          merges: [],
          dataValidations: [],
          conditionalFormats: [],
          conditionalFormats12: [],
          print: emptyPrint,
        }
      : readSheetRecords(
          substream.records,
          globals.sharedStrings,
          formulaSheets,
        );
  const comments =
    substream === undefined
      ? new Map<string, SheetCellComment>()
      : readSheetComments(substream.records);
  const cells = mapCells(raw, globals);
  applyCellComments(comments, cells);
  const dataValidations = mapDataValidations(raw.dataValidations);
  const conditionalFormats = [
    ...mapConditionalFormats(raw.conditionalFormats, globals.palette),
    ...mapConditionalFormats12(raw.conditionalFormats12, globals.palette),
  ];
  // Charts/drawings/images (ExaDev/documents.js#924): a sheet with no substream at all (its BOF's own lbPlyPos matched nothing) has no MsoDrawing bytes to read either, and drawing.ts's own contract already covers that -- an empty worksheetRecords list simply carries no MSODRAWING/Obj records, producing no images and no embeddedObjects.
  const drawing = readSheetDrawing(substream?.records ?? [], {
    blipStore,
    columns: raw.columns,
    rows: raw.rows,
    ownSheetIndex: sheetIndex,
    formulaSheets,
    ownSheetCells: cells,
    metadata: documentMetadata,
    allSubstreams: substreams,
  });
  return {
    name: entry.name,
    cells,
    columns: mapColumns(raw),
    rows: mapRows(raw),
    images: [...drawing.images],
    // The sheet index a print name is scoped to is its BoundSheet8 position -- the index into globals.sheets, before the worksheet-only filter readXlsContent applies -- not its position among the sheets that survive that filter.
    printSettings: mapPrintSettings(
      raw.print,
      globals.printNames.get(sheetIndex),
    ),
    ...(dataValidations.length > 0 ? { dataValidations } : {}),
    ...(conditionalFormats.length > 0 ? { conditionalFormats } : {}),
    ...(drawing.embeddedObjects.length > 0
      ? { embeddedObjects: [...drawing.embeddedObjects] }
      : {}),
  };
}

// Base BIFF8 conditional formatting only ever produces a 'cellIs' rule (ExaDev/documents.js#1102's own scope). icv colour resolution is deferred to here, not workbook/conditional-format.ts, matching how a regular cell's own fill/border already resolve through globals.palette at this same layer (mapCellDecoration below).
function mapConditionalFormats(
  raw: readonly RawConditionalFormat[],
  palette: readonly Color[] | undefined,
): ContentSheetConditionalFormat[] {
  return raw.map((format) => {
    const style = mapConditionalFormatStyle(format.style, palette);
    return {
      type: "cellIs" as const,
      ranges: format.ranges,
      operator: format.operator,
      formula1: format.formula1,
      ...(format.formula2 !== undefined ? { formula2: format.formula2 } : {}),
      ...(style !== undefined ? { style } : {}),
    };
  });
}

// CF12's colour scale/data bar/icon set/filter-template rules. A rule whose own colour cannot be resolved (an automatic or theme colour reference, this package has no BIFF8 Theme reader) is dropped whole rather than promoted with a missing or wrong colour, mirroring the same "narrow rather than guess" boundary the base CF/DXFN reading above already draws.
function mapConditionalFormats12(
  raw: readonly RawConditionalFormat12[],
  palette: readonly Color[] | undefined,
): ContentSheetConditionalFormat[] {
  const results: ContentSheetConditionalFormat[] = [];
  for (const format of raw) {
    const common = {
      ranges: format.ranges,
      priority: format.priority,
      ...(format.stopIfTrue ? { stopIfTrue: true } : {}),
    };
    if (format.kind === "colorScale") {
      const stops = mapColorScaleStops(format.stops, palette);
      if (stops === undefined) {
        continue;
      }
      results.push({ type: "colorScale", stops, ...common });
      continue;
    }
    if (format.kind === "dataBar") {
      const color = mapCfColor(format.color, palette);
      if (color === undefined) {
        continue;
      }
      results.push({
        type: "dataBar",
        min: format.min,
        max: format.max,
        color,
        ...(format.showValue ? {} : { showValue: false }),
        ...common,
      });
      continue;
    }
    if (format.kind === "iconSet") {
      results.push({
        type: "iconSet",
        iconSetType: format.iconSetType,
        thresholds: [...format.thresholds],
        ...(format.reverse ? { reverse: true } : {}),
        ...(format.showValue ? {} : { showValue: false }),
        ...common,
      });
      continue;
    }
    if (format.kind === "top10") {
      const style = mapConditionalFormatStyle(format.style, palette);
      results.push({
        type: "top10",
        rank: format.rank,
        ...(format.percent ? { percent: true } : {}),
        ...(format.bottom ? { bottom: true } : {}),
        ...(style !== undefined ? { style } : {}),
        ...common,
      });
      continue;
    }
    if (format.kind === "aboveAverage") {
      const style = mapConditionalFormatStyle(format.style, palette);
      results.push({
        type: "aboveAverage",
        ...(format.aboveAverage ? {} : { aboveAverage: false }),
        ...(format.equalAverage ? { equalAverage: true } : {}),
        ...(format.stdDev !== undefined ? { stdDev: format.stdDev } : {}),
        ...(style !== undefined ? { style } : {}),
        ...common,
      });
      continue;
    }
    if (format.kind === "timePeriod") {
      const style = mapConditionalFormatStyle(format.style, palette);
      results.push({
        type: "timePeriod",
        timePeriod: format.timePeriod,
        ...(style !== undefined ? { style } : {}),
        ...common,
      });
      continue;
    }
    if (
      format.kind === "containsText" ||
      format.kind === "notContainsText" ||
      format.kind === "beginsWith" ||
      format.kind === "endsWith"
    ) {
      const style = mapConditionalFormatStyle(format.style, palette);
      results.push({
        type: format.kind,
        text: format.text,
        ...(style !== undefined ? { style } : {}),
        ...common,
      });
      continue;
    }
    const style = mapConditionalFormatStyle(format.style, palette);
    results.push({
      type: format.kind,
      ...(style !== undefined ? { style } : {}),
      ...common,
    });
  }
  return results;
}

// CFColor's own tint applies to whichever base colour xclrType named, indexed or RGB alike, so it is applied here, once, after resolving that base colour -- not inside conditional-format-12.ts's own readCfColor, which has no palette to resolve an indexed colour against in the first place.
function mapCfColor(
  raw: RawCfColor,
  palette: readonly Color[] | undefined,
): Color | undefined {
  const base =
    raw.kind === "rgb" ? raw.color : resolveIcvColor(raw.icv, palette);
  return base === undefined ? undefined : applyTint(base, raw.tint);
}

function mapColorScaleStops(
  stops: RawColorScaleFormat["stops"],
  palette: readonly Color[] | undefined,
): { value: ContentSheetConditionalFormatValue; color: Color }[] | undefined {
  const mapped: { value: ContentSheetConditionalFormatValue; color: Color }[] =
    [];
  for (const stop of stops) {
    const color = mapCfColor(stop.color, palette);
    if (color === undefined) {
      return undefined;
    }
    mapped.push({ value: stop.value, color });
  }
  return mapped;
}

function mapConditionalFormatStyle(
  raw: RawConditionalFormatStyle | undefined,
  palette: readonly Color[] | undefined,
): ContentSheetConditionalFormatStyle | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const textColor =
    raw.fontColorIcv === undefined
      ? undefined
      : resolveIcvColor(raw.fontColorIcv, palette);
  // ContentSheetConditionalFormatStyleSchema.background is a plain colour (the two properties actually observed on a real dxf, per that schema's own top comment); resolveFillBackground's own richer solid/pattern ContentCellFill is narrowed to the 'solid' case only, the same narrowing odf.js's own conditional-format.ts already applies for the identical schema field.
  const fill =
    raw.fill === undefined
      ? undefined
      : resolveFillBackground(
          raw.fill.fillPattern,
          raw.fill.fillForegroundIcv,
          raw.fill.fillBackgroundIcv,
          palette,
        );
  const background = fill?.kind === "solid" ? fill.color : undefined;
  if (textColor === undefined && background === undefined) {
    return undefined;
  }
  return {
    ...(textColor !== undefined ? { textColor } : {}),
    ...(background !== undefined ? { background } : {}),
  };
}

// ContentSheetDataValidationSchema's own optional fields all follow the same "true/present means state it, false/empty means omit" convention ooxml.js's own xlsx dataValidation reader established (ExaDev/documents.js#758) -- errorStyle additionally omits its default value ('stop') outright, matching that schema field's own "absent means stop" comment.
function mapDataValidations(
  raw: readonly RawDataValidation[],
): ContentSheetDataValidation[] {
  return raw.map((validation) => ({
    ranges: validation.ranges,
    type: validation.type,
    ...(validation.operator === undefined
      ? {}
      : { operator: validation.operator }),
    ...(validation.formula1 === undefined
      ? {}
      : { formula1: validation.formula1 }),
    ...(validation.formula2 === undefined
      ? {}
      : { formula2: validation.formula2 }),
    ...(validation.allowBlank ? { allowBlank: true } : {}),
    ...(validation.showInputMessage ? { showInputMessage: true } : {}),
    ...(validation.promptTitle.length > 0
      ? { promptTitle: validation.promptTitle }
      : {}),
    ...(validation.prompt.length > 0 ? { prompt: validation.prompt } : {}),
    ...(validation.showErrorMessage ? { showErrorMessage: true } : {}),
    ...(validation.errorStyle === "stop"
      ? {}
      : { errorStyle: validation.errorStyle }),
    ...(validation.errorTitle.length > 0
      ? { errorTitle: validation.errorTitle }
      : {}),
    ...(validation.error.length > 0 ? { error: validation.error } : {}),
  }));
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

// Comments are read from their own Note/Obj/TxO records (workbook/comments.ts), entirely separate from the CELLTABLE cells above, so they attach after the fact -- the same "comments live in their own parts, attach after cells are read" ordering ooxml.js's own content.ts uses for xlsx's own comment mechanism. A comment anchored to a position no cell record ever occupied (a note pinned to an otherwise-empty cell) still carries real content worth keeping, materialised the same way an <f>-only formula cell or a decorated blank cell already is: an empty value with the annotation attached.
function applyCellComments(
  comments: ReadonlyMap<string, SheetCellComment>,
  cells: ContentSheetCell[],
): void {
  if (comments.size === 0) {
    return;
  }
  const byPosition = new Map<string, ContentSheetCell>();
  for (const cell of cells) {
    byPosition.set(`${cell.row}:${cell.column}`, cell);
  }
  for (const [key, { row, column, comment }] of comments) {
    const existing = byPosition.get(key);
    if (existing !== undefined) {
      existing.comment = comment;
      continue;
    }
    const materialised: ContentSheetCell = {
      row,
      column,
      value: { kind: "empty" },
      displayText: "",
      comment,
    };
    cells.push(materialised);
    byPosition.set(key, materialised);
  }
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
  // Resolved before the blank check, because whether a blank cell is worth carrying is exactly the question of whether any of these find anything. Resolved rather than read off the XF's raw fields, so a decoration this reader declines to express -- a fill pattern beyond solid, an unrecognised BorderStyle token, an icv with no fixed RGB value -- counts as none here too.
  const background = backgroundOf(globals, cell.xfIndex);
  const borders = bordersOf(globals, cell.xfIndex);
  const { alignment, verticalAlignment } = alignmentOf(globals, cell.xfIndex);
  const font = fontOf(globals, cell.xfIndex);
  if (
    cell.value.kind === "blank" &&
    background === undefined &&
    borders === undefined &&
    alignment === undefined &&
    verticalAlignment === undefined &&
    font === undefined
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
  if (font !== undefined) {
    mapped.font = font;
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
  if (alignment !== undefined) {
    mapped.alignment = alignment;
  }
  if (verticalAlignment !== undefined) {
    mapped.verticalAlignment = verticalAlignment;
  }
  return mapped;
}

/**
 * A cell's own resolved background fill (ExaDev/documents.js#951), or undefined for a genuinely unfilled cell and for a reserved/unrecognised FillPattern value.
 *
 * A solid fill resolves to a 'solid' ContentCellFill of its own foreground colour; every other named FillPattern -- the 50%/75%/25% gray shades, the stripe and crosshatch family -- resolves to a real 'pattern' fill via xf-colors.ts's own FILL_PATTERN_TO_PATTERN_TYPE, carrying whichever of the pattern's foreground/background colours actually resolve to a fixed RGB value. See xls-codec's README, "Cell decoration".
 */
function backgroundOf(
  globals: WorkbookGlobals,
  xfIndex: number,
): ContentCellFill | undefined {
  const format = globals.cellFormats[xfIndex];
  if (format === undefined) {
    return undefined;
  }
  return resolveFillBackground(
    format.decoration.fillPattern,
    format.decoration.fillForegroundIcv,
    format.decoration.fillBackgroundIcv,
    globals.palette,
  );
}

/** A cell's own resolved horizontal/vertical alignment -- already the exact Alignment/verticalAlignment members (or undefined) globals.ts's readCellFormat resolved through xf-colors.ts's unpackXfAlignment, so this is a lookup rather than a further resolution step, mirroring backgroundOf/bordersOf's own shape. Both fields undefined for a cell whose XF resolves to no CellFormat at all (an out-of-range xfIndex), matching every other resolveXOf helper's behaviour in that case. */
function alignmentOf(
  globals: WorkbookGlobals,
  xfIndex: number,
): { alignment?: Alignment; verticalAlignment?: "top" | "middle" | "bottom" } {
  const format = globals.cellFormats[xfIndex];
  if (format === undefined) {
    return {};
  }
  const result: {
    alignment?: Alignment;
    verticalAlignment?: "top" | "middle" | "bottom";
  } = {};
  if (format.alignment.horizontal !== undefined) {
    result.alignment = format.alignment.horizontal;
  }
  if (format.alignment.vertical !== undefined) {
    result.verticalAlignment = format.alignment.vertical;
  }
  return result;
}

/**
 * A cell's own font, or undefined when the cell states none of its own: the font its XF's ifnt names, diffed against the workbook's own first font (the Normal style's, entry 0 of the font table) so that only properties the cell genuinely differs in survive -- the same default-omission policy alignmentOf applies to ALCGEN/ALCVBOT and the fill reader to FLSNULL. A cell whose XF resolves to no CellFormat at all, or whose font index resolves past the end of the font table, carries no font, matching every other resolveXOf helper's behaviour for an out-of-range index.
 */
function fontOf(
  globals: WorkbookGlobals,
  xfIndex: number,
): ContentFont | undefined {
  const format = globals.cellFormats[xfIndex];
  if (format === undefined) {
    return undefined;
  }
  const font = globals.fonts[format.fontIndex];
  const baseline = globals.fonts[0];
  if (font === undefined || baseline === undefined) {
    return undefined;
  }
  return contentFontOf(font, baseline, (icv) =>
    resolveFontColor(icv, globals.palette),
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
