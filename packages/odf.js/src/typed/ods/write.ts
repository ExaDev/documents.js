import type {
  Alignment,
  Color,
  ContentCellFill,
  ContentCellValue,
  ContentDocument,
  ContentRun,
  ContentSheet,
  ContentSheetCell,
  ContentSheetColumn,
  ContentSheetImage,
  ContentSheetPrintSettings,
  ContentSheetRow,
  DocumentTree,
} from "document-schema.js";
import {
  colorToRgbHex,
  flattenTree,
  resolveCellFillColor,
  rgbHexToColor,
} from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { ODF_MEDIA_TYPES } from "../../media-type";
import { syncManifest } from "../../manifest";
import {
  createOdfPackage,
  odfPartContainer,
  DEFAULT_ODF_VERSION,
} from "../../package-io/scaffold";
import { StyleRegistry } from "../../styles/registry";
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import { formatOdfLength } from "../shared/units";
import { imageExtension } from "../shared/image";
import { formatOdfColor } from "../shared/color";
import { writeOdfMetadata } from "../shared/metadata";
import {
  writeOdfParagraph,
  segmentOdfParagraphRuns,
} from "../shared/paragraph";
import { cellReference } from "../shared/a1";
import {
  BORDER_EDGE_ATTRS,
  BORDER_EDGE_KEYS,
  formatBorderEdge,
} from "../shared/table";
import { DEFAULT_COLUMN_WIDTH_PT, DEFAULT_ROW_HEIGHT_PT } from "./read";

// ContentDocument (the 'spreadsheet' arm) -> a real .ods Package: the inverse of typed/ods/read.ts, and the second content WRITER in this package's typed layer (the first, typed/odt/write.ts, states the philosophy this module follows in full and is worth reading first). Every mapping below is stated as the exact inverse of the corresponding read in that module rather than as an independent idea of what an .ods should look like -- the correctness property this writer is held to is that its own package reads back as the document it was given (see normaliseOdsContent below for the one canonical form that equality is stated against, and write.test.ts / write-round-trip.test.ts for both halves).
//
// WHAT THIS WRITER DOES NOT WRITE, and why: dataValidations and conditionalFormats are refused BY NAME when present -- readOdsContent never populates either field (it has no table:content-validation or calcext:conditional-formats reading at all today, only a whole-element residue quarantine for the latter), so a document carrying either is semantic content this writer has no inverse for; writing one would either drop it silently or misrepresent it, and the odt writer's own stated stance ("writing a document that silently lost semantic content is worse than not writing it at all") applies here too. embeddedObjects (including the 'chart' kind) are refused BY NAME for every sheet, matching the odt writer's own blanket refusal of every embedded-object kind -- odf.js's typed layer has no write-side embedded-sub-document machinery at all yet (no writer builds an "Object N/" package, wires its manifest entries, or emits a draw:object reference), and building that from scratch is a substantial undertaking of its own, out of scope for landing the first genuine .ods writer at the same scope the odt writer itself first landed at. The one deliberate exception, shared with the odt writer, is the quarantined residue channel: `sheet.source` is dropped on write, a known, tracked, restorable-fidelity gap rather than a silent one. A cell's own `numberFormatCode` is likewise not written as a `number:*` data-style/`style:data-style-name` reference: readOdsContent does not populate that field for any cell today (it has no data-style reading wired into its own walk at all, unlike readOdtContent's field-master reading), so there is no genuine inverse to write against or verify -- every cell value kind still writes back with the correct `office:value-type` regardless, which is the fact that actually round-trips. A cell's `comment` is likewise not written -- readOdsContent never populates it either.
//
// THE ONE FORCED ASYMMETRY THIS WRITER CANNOT PAPER OVER: a 'time' cell's ISO 8601 HH:MM:SS wall-clock value (document-schema.js's own documented wire contract for ContentCellValueSchema's 'time' kind) has no direct ODF spelling -- office:time-value is an xsd:duration ("PT13H30M00S"), and a conformant producer must convert between the two. This writer performs that conversion on write (see formatOdfDuration), because writing the ISO clock string directly into office:time-value would be invalid ODF that no real spreadsheet application could open correctly. readOdsContent, however, does not perform the inverse conversion today (see that module's own readCellValue: `attrValue(cellElement, "office:time-value") ?? displayText`, carried through unconverted) -- a narrow, pre-existing, unrelated reader gap this writer's own correctness cannot depend on being fixed. normaliseOdsContent states the resulting canonical form precisely (the raw xsd:duration string, not the ISO clock string) rather than hand-waving it, and the gap is tracked as a follow-up rather than silently worked around by emitting non-conformant XML to make today's reader happy.

const CONTENT_PART = "content.xml";
const STYLES_PART = "styles.xml";
const PICTURES_DIRECTORY = "Pictures";

export interface OdsWriteOptions {
  // The ODF version stamped on each part's office:version and on the manifest. Defaults to the current standard.
  readonly version?: string;
  // Stamps the package as a document template (ODF_MEDIA_TYPES.ots) rather than a regular document (ODF_MEDIA_TYPES.ods) -- the "mimetype" part and the manifest root entry syncManifest derives from it, both of which createOdfPackage/syncManifest already key off whatever media type is passed in. Nothing else about the writer's own output changes: ODF makes no other structural distinction between a document and its template. Defaults to false.
  readonly template?: boolean;
}

function unsupported(what: string, where: string): Error {
  return new Error(
    `writeOds: ${where} carries ${what}, which this writer does not write yet -- refusing rather than producing an .ods that silently lost it. See ExaDev/documents.js for the tracked follow-up covering embedded objects, data validation, and conditional formatting.`,
  );
}

// --- cell values: ContentCellValue -> office:value-type + its own value attribute ------------------------------------

// A 'PT<h>H<m>M<s>S' xsd:duration literal from an ISO 8601 HH:MM:SS wall-clock string -- the inverse this format's own datatype forces (see this module's own top-of-file note on why readOdsContent cannot yet undo it). Malformed input (anything not matching the canonical wire spelling document-schema.js's own ContentCellValueSchema documents for 'time') is refused rather than guessed at: a producer emitting an unparseable duration would be worse than one that refuses outright.
function formatOdfDuration(isoTime: string): string {
  const match = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(isoTime);
  if (match === null) {
    throw new Error(
      `writeOdsContent: a "time" cell's value "${isoTime}" is not the canonical ISO 8601 HH:MM:SS wall-clock spelling document-schema.js's ContentCellValueSchema documents -- refusing to guess at an ODF xsd:duration equivalent`,
    );
  }
  const [, hours, minutes, seconds, fraction] = match;
  const secondsLiteral =
    fraction === undefined
      ? String(Number(seconds))
      : `${Number(seconds)}.${fraction}`;
  return `PT${Number(hours)}H${Number(minutes)}M${secondsLiteral}S`;
}

// The office:value attribute's own literal: exactValue (the arbitrary-precision decimal string, when the producer's own value would not survive a bare double round trip) is preferred over String(value) precisely because it is the more precise fact to hand a real spreadsheet application, and reading it back through readCellValue's own `Number(raw)` recovers the identical double either way.
function formatCellNumberLiteral(value: {
  value: number;
  exactValue?: string;
}): string {
  return value.exactValue ?? String(value.value);
}

function unsupportedCellValueKind(kind: string): Error {
  return new Error(
    `writeOdsContent: a cell carries a "${kind}" value, which this writer does not write -- readOdsContent's own reader can never produce this kind for an .ods document (see its own doc comment), so there is no genuine inverse to verify a write against; refusing rather than writing a document that would read back reporting a different value kind than it was given.`,
  );
}

function writeCellValueAttributes(
  value: ContentCellValue,
): Record<string, string> {
  switch (value.kind) {
    case "number":
      return {
        "office:value-type": "float",
        "office:value": formatCellNumberLiteral(value),
      };
    case "percentage":
      return {
        "office:value-type": "percentage",
        "office:value": formatCellNumberLiteral(value),
      };
    case "currency": {
      const attributes: Record<string, string> = {
        "office:value-type": "currency",
        "office:value": formatCellNumberLiteral(value),
      };
      if (value.currency !== undefined) {
        attributes["office:currency"] = encodeXmlText(value.currency);
      }
      return attributes;
    }
    case "boolean":
      return {
        "office:value-type": "boolean",
        "office:boolean-value": value.value ? "true" : "false",
      };
    case "date":
      return {
        "office:value-type": "date",
        "office:date-value": encodeXmlText(value.value),
      };
    case "time":
      return {
        "office:value-type": "time",
        "office:time-value": encodeXmlText(formatOdfDuration(value.value)),
      };
    case "string":
      return {
        "office:value-type": "string",
        "office:string-value": encodeXmlText(value.value),
      };
    case "empty":
      return {};
    case "dateTime":
    case "error":
      throw unsupportedCellValueKind(value.kind);
  }
}

// --- a cell's own rendered text: ContentSheetCell.runs/displayText -> one text:p per readCellText's own multi-paragraph join --------

// Whether a run is EXACTLY the bare paragraph-separator readCellText's own multi-text:p join synthesises (`runs.push({ text: "\n" })`, carrying no formatting field at all) -- the only shape a text:p boundary can ever produce on the way back in, so it is the only shape this writer can recreate faithfully by splitting into a new text:p rather than embedding a text:line-break. A "\n" run carrying any formatting or a hyperlink came from a real text:line-break inside one paragraph (collectRuns' own text:line-break handling threads the surrounding span's baseProperties through it), and is left to flow through writeOdfParagraph's own established segmentOdfParagraphRuns/segmentOdfText splitting untouched, which reproduces it -- formatting and all -- as a text:line-break inside the correct text:span, exactly as it would have read.
function isBareNewlineRun(run: ContentRun): boolean {
  return (
    run.text === "\n" &&
    run.bold === undefined &&
    run.italic === undefined &&
    run.underline === undefined &&
    run.strike === undefined &&
    run.fontFamily === undefined &&
    run.sizePt === undefined &&
    run.color === undefined &&
    run.hyperlink === undefined
  );
}

// The runs a cell actually carries, falling back to a single plain run of its own displayText when no `runs` field is present -- mirroring readCellText's own "the cell's rendered text IS its runs" convention for the common, unformatted case.
function cellSourceRuns(cell: ContentSheetCell): ContentRun[] {
  if (cell.runs !== undefined) {
    return [...cell.runs];
  }
  return cell.displayText.length > 0 ? [{ text: cell.displayText }] : [];
}

// Splits a cell's own runs at every bare newline run into the groups this writer emits as separate text:p elements -- shared between the writer (writeCellParagraphs, below) and the round-trip canonicaliser (canonicalCellRuns) so the two can never disagree about the grouping, mirroring the odt writer's own shared-plan discipline.
function planCellTextGroups(cell: ContentSheetCell): ContentRun[][] {
  const runs = cellSourceRuns(cell);
  const groups: ContentRun[][] = [[]];
  for (const run of runs) {
    if (isBareNewlineRun(run)) {
      groups.push([]);
    } else {
      groups[groups.length - 1]!.push(run);
    }
  }
  return groups;
}

function writeCellParagraphs(
  cell: ContentSheetCell,
  registry: StyleRegistry,
): XmlElement[] {
  return planCellTextGroups(cell).map((group) =>
    writeOdfParagraph({ kind: "paragraph", runs: group }, registry),
  );
}

// --- cell decoration: background/borders/alignment/verticalAlignment -> one table-cell-family automatic style ---------
//
// Alignment lives on a SIBLING style:paragraph-properties child of the SAME style:style[family="table-cell"] element that carries the table-cell-properties background/border/vertical-align bag -- confirmed by readCellStyleDecoration (typed/shared/table.ts), which reads fo:text-align from exactly that position, not from the cell's own text:p style. Writing both children on one minted style, rather than a separate paragraph-family style, is therefore the genuine inverse of what the reader resolves.

function sheetCellStyle(
  cell: ContentSheetCell,
  registry: StyleRegistry,
): string | undefined {
  const cellProperties: Record<string, string> = {};
  // ODF's fo:background-color states one flat colour with no pattern-fill vocabulary at all, so a 'pattern' fill approximates through resolveCellFillColor's own single representative colour (ExaDev/documents.js#951) -- the same degradation typed/shared/table.ts's own tableCellStyle applies for odt/odp cell fills.
  const backgroundColor =
    cell.background === undefined
      ? undefined
      : resolveCellFillColor(cell.background);
  if (backgroundColor !== undefined) {
    cellProperties["fo:background-color"] = formatOdfColor(backgroundColor);
  }
  if (cell.borders !== undefined) {
    for (const edge of BORDER_EDGE_KEYS) {
      const border = cell.borders[edge];
      if (border !== undefined) {
        cellProperties[BORDER_EDGE_ATTRS[edge]] = formatBorderEdge(border);
      }
    }
  }
  if (cell.verticalAlignment !== undefined) {
    cellProperties["style:vertical-align"] = cell.verticalAlignment;
  }

  const propertyElements: XmlElement[] = [];
  if (Object.keys(cellProperties).length > 0) {
    propertyElements.push(el("style:table-cell-properties", cellProperties));
  }
  if (cell.alignment !== undefined) {
    propertyElements.push(
      el("style:paragraph-properties", { "fo:text-align": cell.alignment }),
    );
  }
  if (propertyElements.length === 0) {
    return undefined;
  }
  return registry.intern({
    properties: {},
    family: "table-cell",
    propertyElements,
  });
}

function sheetColumnStyle(
  widthPt: number | undefined,
  manualBreak: boolean,
  registry: StyleRegistry,
): string | undefined {
  const properties: Record<string, string> = {};
  if (widthPt !== undefined) {
    properties["style:column-width"] = formatOdfLength(widthPt);
  }
  if (manualBreak) {
    properties["fo:break-before"] = "page";
  }
  if (Object.keys(properties).length === 0) {
    return undefined;
  }
  return registry.intern({
    properties: {},
    family: "table-column",
    propertyElements: [el("style:table-column-properties", properties)],
  });
}

function sheetRowStyle(
  heightPt: number | undefined,
  manualBreak: boolean,
  registry: StyleRegistry,
): string | undefined {
  const properties: Record<string, string> = {};
  if (heightPt !== undefined) {
    properties["style:row-height"] = formatOdfLength(heightPt);
  }
  if (manualBreak) {
    properties["fo:break-before"] = "page";
  }
  if (Object.keys(properties).length === 0) {
    return undefined;
  }
  return registry.intern({
    properties: {},
    family: "table-row",
    propertyElements: [el("style:table-row-properties", properties)],
  });
}

// --- the used range: every position this writer must materialise a table:table-column/-row element for ---------------
//
// ODF's own table:table-column/table:table-row model is purely positional -- there is no "skip to column N" spelling -- so a sparse `columns`/`rows`/`cells` input has to be densified into one element per position from 0 up to the highest position anything in the sheet actually references, INDEPENDENTLY per axis (a column-only declaration must never force a row to exist, and vice versa).
interface UsedRange {
  readonly maxRow: number | undefined;
  readonly maxColumn: number | undefined;
}

function computeUsedRange(sheet: ContentSheet): UsedRange {
  let maxRow: number | undefined;
  let maxColumn: number | undefined;
  const bumpRow = (row: number): void => {
    if (maxRow === undefined || row > maxRow) {
      maxRow = row;
    }
  };
  const bumpColumn = (column: number): void => {
    if (maxColumn === undefined || column > maxColumn) {
      maxColumn = column;
    }
  };

  for (const cell of sheet.cells) {
    bumpRow(cell.row + (cell.rowSpan ?? 1) - 1);
    bumpColumn(cell.column + (cell.colSpan ?? 1) - 1);
  }
  for (const column of sheet.columns) {
    bumpColumn(column.index);
  }
  for (const row of sheet.rows) {
    bumpRow(row.index);
  }
  for (const image of sheet.images) {
    bumpRow(image.anchorRow);
    bumpColumn(image.anchorColumn);
  }
  const printSettings = sheet.printSettings;
  if (printSettings.repeatColumns !== undefined) {
    bumpColumn(printSettings.repeatColumns.end);
  }
  if (printSettings.repeatRows !== undefined) {
    bumpRow(printSettings.repeatRows.end);
  }
  if (printSettings.manualBreaks !== undefined) {
    for (const row of printSettings.manualBreaks.rows) {
      bumpRow(row);
    }
    for (const column of printSettings.manualBreaks.columns) {
      bumpColumn(column);
    }
  }
  if (printSettings.printRange !== undefined) {
    bumpRow(printSettings.printRange.endRow);
    bumpColumn(printSettings.printRange.endColumn);
  }

  return { maxRow, maxColumn };
}

function coverageKey(row: number, column: number): string {
  return `${row},${column}`;
}

function computeCoveredPositions(
  cells: readonly ContentSheetCell[],
): ReadonlySet<string> {
  const covered = new Set<string>();
  for (const cell of cells) {
    const rowSpan = cell.rowSpan ?? 1;
    const colSpan = cell.colSpan ?? 1;
    for (let row = cell.row; row < cell.row + rowSpan; row += 1) {
      for (
        let column = cell.column;
        column < cell.column + colSpan;
        column += 1
      ) {
        if (row !== cell.row || column !== cell.column) {
          covered.add(coverageKey(row, column));
        }
      }
    }
  }
  return covered;
}

function groupImagesByPosition(
  images: readonly ContentSheetImage[],
): ReadonlyMap<string, ContentSheetImage[]> {
  const byPosition = new Map<string, ContentSheetImage[]>();
  for (const image of images) {
    const key = coverageKey(image.anchorRow, image.anchorColumn);
    const existing = byPosition.get(key);
    if (existing === undefined) {
      byPosition.set(key, [image]);
    } else {
      existing.push(image);
    }
  }
  return byPosition;
}

// --- images: ContentSheetImage -> a draw:frame anchored directly inside its own table:table-cell ----------------------
//
// Every image this writer places is written cell-anchored (a direct child of the table:table-cell at anchorRow/anchorColumn, with svg:x/svg:y as the offsets readDrawFrame parses directly), never as a table:shapes page-anchored entry -- and that is a genuine, not merely convenient, choice: readOdsContent's own two anchoring conventions are numerically INDISTINGUISHABLE at row 0/column 0 (cell (0,0)'s own top-left IS the sheet origin, per that module's own top-of-file note), so a page-anchored image reads back with exactly the same anchorRow/anchorColumn/offsetXPt/offsetYPt a cell-anchored one at (0,0) would. Writing every image cell-anchored is therefore not a narrowing of what this writer can express -- it is the one representation that already covers both source conventions losslessly.
function writeSheetImageFrame(
  image: ContentSheetImage,
  state: OdsWriteState,
): XmlElement {
  const extension = imageExtension(image.format);
  const path = `${PICTURES_DIRECTORY}/image${state.nextImage}.${extension}`;
  state.nextImage += 1;
  state.pkg.parts[path] = { kind: "binary", base64: image.base64 };
  const children: XmlNode[] = [
    el("draw:image", {
      "xlink:href": encodeXmlText(path),
      "xlink:type": "simple",
      "xlink:show": "embed",
      "xlink:actuate": "onLoad",
    }),
  ];
  if (image.altText !== undefined) {
    children.push(el("svg:title", {}, [txt(encodeXmlText(image.altText))]));
  }
  return el(
    "draw:frame",
    {
      "draw:z-index": String(state.nextZIndex++),
      "svg:x": formatOdfLength(image.offsetXPt),
      "svg:y": formatOdfLength(image.offsetYPt),
      "svg:width": formatOdfLength(image.widthPt),
      "svg:height": formatOdfLength(image.heightPt),
    },
    children,
  );
}

// --- print settings: ContentSheetPrintSettings -> a master page + page layout the sheet's own table style names ------

function sheetPageLayoutElement(
  name: string,
  printSettings: ContentSheetPrintSettings,
): XmlElement {
  const properties: Record<string, string> = {
    "fo:page-width": formatOdfLength(printSettings.pageSize.widthPt),
    "fo:page-height": formatOdfLength(printSettings.pageSize.heightPt),
    "fo:margin-top": formatOdfLength(printSettings.margins.topPt),
    "fo:margin-right": formatOdfLength(printSettings.margins.rightPt),
    "fo:margin-bottom": formatOdfLength(printSettings.margins.bottomPt),
    "fo:margin-left": formatOdfLength(printSettings.margins.leftPt),
    "style:print-page-order":
      printSettings.pageOrder === "overThenDown" ? "ltr" : "ttb",
  };
  const printTokens: string[] = [];
  if (printSettings.gridlines) {
    printTokens.push("grid");
  }
  if (printSettings.headers) {
    printTokens.push("headers");
  }
  if (printTokens.length > 0) {
    properties["style:print"] = printTokens.join(" ");
  }
  if (printSettings.scalePercent !== undefined) {
    properties["style:scale-to"] = `${printSettings.scalePercent}%`;
  }
  if (printSettings.fitToPages !== undefined) {
    properties["style:scale-to-X"] = String(printSettings.fitToPages.width);
    properties["style:scale-to-Y"] = String(printSettings.fitToPages.height);
  }
  return el("style:page-layout", { "style:name": encodeXmlText(name) }, [
    el("style:page-layout-properties", properties),
  ]);
}

// table:print-ranges is a space-separated list of "SheetName.StartCell:SheetName.EndCell" ranges, both halves carrying the sheet-name prefix (see typed/ods/read.ts's own parsePrintRanges) -- ContentSheetPrintSettingsSchema carries only one, so only one is ever written.
function formatPrintRange(
  range: NonNullable<ContentSheetPrintSettings["printRange"]>,
  sheetName: string,
): string {
  const start = cellReference(range.startColumn, range.startRow);
  const end = cellReference(range.endColumn, range.endRow);
  const qualifiedSheet = encodeXmlText(sheetName);
  return `${qualifiedSheet}.${start}:${qualifiedSheet}.${end}`;
}

// --- the write-side plan: which rows/columns fall inside a table:table-header-rows/-columns wrapper -------------------

function wrapHeaderRange(
  elements: readonly XmlElement[],
  range: { start: number; end: number } | undefined,
  wrapperTag: string,
): XmlNode[] {
  if (range === undefined) {
    return [...elements];
  }
  const before = elements.slice(0, range.start);
  const wrapped = elements.slice(range.start, range.end + 1);
  const after = elements.slice(range.end + 1);
  return [...before, el(wrapperTag, {}, wrapped), ...after];
}

// --- the mutable write state, mirroring typed/odt/write.ts's OdtWriteState -----------------------------------------

interface OdsWriteState {
  readonly pkg: Package;
  readonly registry: StyleRegistry;
  readonly contentAutomaticStyles: XmlElement;
  readonly stylesAutomaticStyles: XmlElement;
  readonly masterStyles: XmlElement;
  nextImage: number;
  nextZIndex: number;
  nextSheetStyle: number;
}

function writeColumns(
  sheet: ContentSheet,
  state: OdsWriteState,
  manualBreakColumns: ReadonlySet<number>,
  maxColumn: number | undefined,
): XmlNode[] {
  if (maxColumn === undefined) {
    return [];
  }
  const byIndex = new Map(
    sheet.columns.map((column) => [column.index, column]),
  );
  const elements: XmlElement[] = [];
  for (let index = 0; index <= maxColumn; index += 1) {
    const declared = byIndex.get(index);
    const styleName = sheetColumnStyle(
      declared?.widthPt,
      manualBreakColumns.has(index),
      state.registry,
    );
    const attributes: Record<string, string> = {};
    if (styleName !== undefined) {
      attributes["table:style-name"] = encodeXmlText(styleName);
    }
    if (declared?.hidden === true) {
      attributes["table:visibility"] = "collapse";
    }
    elements.push(el("table:table-column", attributes));
  }
  return wrapHeaderRange(
    elements,
    sheet.printSettings.repeatColumns,
    "table:table-header-columns",
  );
}

function writeRowCells(
  row: number,
  maxColumn: number | undefined,
  cellByPosition: ReadonlyMap<string, ContentSheetCell>,
  imagesByPosition: ReadonlyMap<string, ContentSheetImage[]>,
  covered: ReadonlySet<string>,
  state: OdsWriteState,
): XmlElement[] {
  if (maxColumn === undefined) {
    return [];
  }
  const nodes: XmlElement[] = [];
  let column = 0;
  while (column <= maxColumn) {
    const key = coverageKey(row, column);
    if (covered.has(key)) {
      let end = column;
      while (
        end + 1 <= maxColumn &&
        covered.has(coverageKey(row, end + 1)) &&
        !cellByPosition.has(coverageKey(row, end + 1))
      ) {
        end += 1;
      }
      const count = end - column + 1;
      nodes.push(
        el(
          "table:covered-table-cell",
          count > 1 ? { "table:number-columns-repeated": String(count) } : {},
        ),
      );
      column = end + 1;
      continue;
    }

    const cell = cellByPosition.get(key);
    const images = imagesByPosition.get(key);
    if (cell !== undefined || (images !== undefined && images.length > 0)) {
      const attributes: Record<string, string> = {};
      if (cell !== undefined) {
        Object.assign(attributes, writeCellValueAttributes(cell.value));
        if (cell.formula !== undefined) {
          attributes["table:formula"] = encodeXmlText(cell.formula);
        }
        if (cell.colSpan !== undefined) {
          attributes["table:number-columns-spanned"] = String(cell.colSpan);
        }
        if (cell.rowSpan !== undefined) {
          attributes["table:number-rows-spanned"] = String(cell.rowSpan);
        }
        const styleName = sheetCellStyle(cell, state.registry);
        if (styleName !== undefined) {
          attributes["table:style-name"] = encodeXmlText(styleName);
        }
      }
      const children: XmlNode[] =
        cell === undefined ? [] : writeCellParagraphs(cell, state.registry);
      for (const image of images ?? []) {
        children.push(writeSheetImageFrame(image, state));
      }
      nodes.push(el("table:table-cell", attributes, children));
      column += 1;
      continue;
    }

    let end = column;
    while (
      end + 1 <= maxColumn &&
      !covered.has(coverageKey(row, end + 1)) &&
      !cellByPosition.has(coverageKey(row, end + 1)) &&
      (imagesByPosition.get(coverageKey(row, end + 1))?.length ?? 0) === 0
    ) {
      end += 1;
    }
    const count = end - column + 1;
    nodes.push(
      el(
        "table:table-cell",
        count > 1 ? { "table:number-columns-repeated": String(count) } : {},
      ),
    );
    column = end + 1;
  }
  return nodes;
}

function writeRows(
  sheet: ContentSheet,
  state: OdsWriteState,
  manualBreakRows: ReadonlySet<number>,
  maxRow: number | undefined,
  maxColumn: number | undefined,
): XmlNode[] {
  if (maxRow === undefined) {
    return [];
  }
  const rowByIndex = new Map(sheet.rows.map((row) => [row.index, row]));
  const cellByPosition = new Map(
    sheet.cells.map((cell) => [coverageKey(cell.row, cell.column), cell]),
  );
  const imagesByPosition = groupImagesByPosition(sheet.images);
  const covered = computeCoveredPositions(sheet.cells);

  const elements: XmlElement[] = [];
  for (let row = 0; row <= maxRow; row += 1) {
    const declared = rowByIndex.get(row);
    const styleName = sheetRowStyle(
      declared?.heightPt,
      manualBreakRows.has(row),
      state.registry,
    );
    const attributes: Record<string, string> = {};
    if (styleName !== undefined) {
      attributes["table:style-name"] = encodeXmlText(styleName);
    }
    if (declared?.hidden === true) {
      attributes["table:visibility"] = "collapse";
    }
    const cells = writeRowCells(
      row,
      maxColumn,
      cellByPosition,
      imagesByPosition,
      covered,
      state,
    );
    elements.push(el("table:table-row", attributes, cells));
  }
  return wrapHeaderRange(
    elements,
    sheet.printSettings.repeatRows,
    "table:table-header-rows",
  );
}

function writeSheet(sheet: ContentSheet, state: OdsWriteState): XmlElement {
  if (sheet.embeddedObjects !== undefined && sheet.embeddedObjects.length > 0) {
    throw unsupported(
      `an embedded object ("${sheet.embeddedObjects[0]!.objectKind}")`,
      `sheet "${sheet.name}"`,
    );
  }
  if (sheet.dataValidations !== undefined && sheet.dataValidations.length > 0) {
    throw unsupported("a data-validation rule", `sheet "${sheet.name}"`);
  }
  if (
    sheet.conditionalFormats !== undefined &&
    sheet.conditionalFormats.length > 0
  ) {
    throw unsupported("a conditional-formatting rule", `sheet "${sheet.name}"`);
  }

  const { maxRow, maxColumn } = computeUsedRange(sheet);
  const manualBreakRows = new Set(sheet.printSettings.manualBreaks?.rows ?? []);
  const manualBreakColumns = new Set(
    sheet.printSettings.manualBreaks?.columns ?? [],
  );

  const ordinal = state.nextSheetStyle;
  state.nextSheetStyle += 1;
  const masterPageName = `SheetMP${ordinal}`;
  const pageLayoutName = `SheetPL${ordinal}`;
  const tableStyleName = `SheetTable${ordinal}`;

  state.stylesAutomaticStyles.children.push(
    sheetPageLayoutElement(pageLayoutName, sheet.printSettings),
  );
  state.masterStyles.children.push(
    el("style:master-page", {
      "style:name": encodeXmlText(masterPageName),
      "style:page-layout-name": encodeXmlText(pageLayoutName),
    }),
  );
  // The sheet's own table-family style is minted directly rather than through StyleRegistry.intern(): every sheet needs its own distinct style:master-page-name, a fact intern()'s properties/propertyElements fingerprint has no field for, so two sheets with otherwise-identical (empty) property bags would collide onto one shared style. The name is drawn from a counter in a namespace ("SheetTable{n}") the registry's own "ta{n}"/"taS{n}" minting scheme can never produce, so the two can never collide even though this element bypasses the registry's own bookkeeping entirely.
  state.contentAutomaticStyles.children.push(
    el(
      "style:style",
      {
        "style:name": encodeXmlText(tableStyleName),
        "style:family": "table",
        "style:master-page-name": encodeXmlText(masterPageName),
      },
      [el("style:table-properties", { "table:display": "true" })],
    ),
  );

  const columns = writeColumns(sheet, state, manualBreakColumns, maxColumn);
  const rows = writeRows(sheet, state, manualBreakRows, maxRow, maxColumn);

  const tableAttributes: Record<string, string> = {
    "table:name": encodeXmlText(sheet.name),
    "table:style-name": encodeXmlText(tableStyleName),
  };
  if (sheet.printSettings.printRange !== undefined) {
    tableAttributes["table:print-ranges"] = encodeXmlText(
      formatPrintRange(sheet.printSettings.printRange, sheet.name),
    );
  }

  return el("table:table", tableAttributes, [...columns, ...rows]);
}

// --- the canonical form: what reading this writer's own output back produces ----------------------------------------

function canonicalColor(color: Color): Color {
  return rgbHexToColor(colorToRgbHex(color));
}

// A cell fill written and read back through this writer: always a 'solid' ContentCellFill, since fo:background-color has no two-colour pattern-fill vocabulary at all (ExaDev/documents.js#951) -- sheetCellStyle above resolves a 'pattern' fill to resolveCellFillColor's own single representative colour before it ever reaches ODF, and undefined when that resolves to nothing (a pattern stating neither of its own colours), matching an absent background exactly.
function canonicalCellFill(fill: ContentCellFill): ContentCellFill | undefined {
  const color = resolveCellFillColor(fill);
  return color === undefined
    ? undefined
    : { kind: "solid", color: canonicalColor(color) };
}

// A ContentRun carrying only the fields it actually states -- the same spelled-only canonical form typed/odt/write.ts's own canonicalRun establishes for wordprocessing runs, restated here rather than imported: the two writers are independent codec modules, and this is a small, self-contained defaulting function rather than a shared abstraction worth coupling them over.
function canonicalRun(run: ContentRun): ContentRun {
  const canonical: ContentRun = { text: run.text };
  if (run.bold !== undefined) canonical.bold = run.bold;
  if (run.italic !== undefined) canonical.italic = run.italic;
  if (run.underline !== undefined) canonical.underline = run.underline;
  if (run.strike !== undefined) canonical.strike = run.strike;
  if (run.fontFamily !== undefined) canonical.fontFamily = run.fontFamily;
  if (run.sizePt !== undefined) canonical.sizePt = run.sizePt;
  if (run.color !== undefined) canonical.color = canonicalColor(run.color);
  if (run.hyperlink !== undefined) canonical.hyperlink = run.hyperlink;
  return canonical;
}

// The exact runs reading this writer's own cell text back produces: each planCellTextGroups group canonicalised through segmentOdfParagraphRuns (the same fixed point typed/shared/paragraph.ts's own writeOdfParagraph/readOdfParagraph pair already establishes for any ODF text:p), rejoined with a bare {text:'\n'} at every group boundary -- exactly the shape readCellText's own synthetic separator produces, regardless of what a same-valued source run originally carried (see isBareNewlineRun's own note on why that asymmetry is unavoidable).
function canonicalCellRuns(cell: ContentSheetCell): ContentRun[] {
  const groups = planCellTextGroups(cell).map((group) =>
    segmentOdfParagraphRuns(group).map(canonicalRun),
  );
  const combined: ContentRun[] = [];
  groups.forEach((group, index) => {
    if (index > 0) {
      combined.push({ text: "\n" });
    }
    combined.push(...group);
  });
  return combined;
}

// The exact ContentCellValue reading this writer's own written cell back produces. exactValue never survives -- readCellValue has no field for it, only ever reading office:value back into the nearest-double `value` -- and a 'time' cell reads back as the raw xsd:duration string this writer wrote, per this module's own top-of-file note on that forced, pre-existing asymmetry.
function canonicalCellValue(value: ContentCellValue): ContentCellValue {
  switch (value.kind) {
    case "number":
      return { kind: "number", value: Number(formatCellNumberLiteral(value)) };
    case "percentage":
      return {
        kind: "percentage",
        value: Number(formatCellNumberLiteral(value)),
      };
    case "currency": {
      const canonical: ContentCellValue = {
        kind: "currency",
        value: Number(formatCellNumberLiteral(value)),
      };
      if (value.currency !== undefined) {
        canonical.currency = value.currency;
      }
      return canonical;
    }
    case "boolean":
      return { kind: "boolean", value: value.value };
    case "date":
      return { kind: "date", value: value.value };
    case "time":
      return { kind: "time", value: formatOdfDuration(value.value) };
    case "string":
      return { kind: "string", value: value.value };
    case "empty":
      return { kind: "empty" };
    case "dateTime":
    case "error":
      throw unsupportedCellValueKind(value.kind);
  }
}

// One cell's canonical form, or undefined when readOdsContent's own trailing-empty-cell skip drops it entirely: a cell carrying no formula, no office:value-type-bearing value (kind 'empty'), and no rendered text is never materialised by the reader at all, regardless of what colSpan/background/borders it stated -- readTable's own skip test (`!hasValueType && formula === undefined && displayText.length === 0`) runs before any of those attributes are even considered. This is a real, forced normalisation, not a writer choice: any of those facts on such a cell is lost on the round trip because ODF's own trailing-empty-cell compression convention has nowhere else to put them.
function canonicalCell(cell: ContentSheetCell): ContentSheetCell | undefined {
  const runs = canonicalCellRuns(cell);
  const displayText = runs.map((run) => run.text).join("");
  if (
    cell.value.kind === "empty" &&
    cell.formula === undefined &&
    displayText.length === 0
  ) {
    return undefined;
  }

  const canonical: ContentSheetCell = {
    row: cell.row,
    column: cell.column,
    value: canonicalCellValue(cell.value),
    displayText,
  };
  if (cell.formula !== undefined) {
    canonical.formula = cell.formula;
  }
  if (runs.length > 0) {
    canonical.runs = runs;
  }
  if (cell.colSpan !== undefined) {
    canonical.colSpan = cell.colSpan;
  }
  if (cell.rowSpan !== undefined) {
    canonical.rowSpan = cell.rowSpan;
  }
  if (cell.background !== undefined) {
    canonical.background = canonicalCellFill(cell.background);
  }
  if (cell.borders !== undefined) {
    const borders: NonNullable<ContentSheetCell["borders"]> = {};
    for (const edge of BORDER_EDGE_KEYS) {
      const border = cell.borders[edge];
      if (border !== undefined) {
        borders[edge] = {
          color: canonicalColor(border.color),
          widthPt: border.widthPt,
          style: border.style ?? "solid",
        };
      }
    }
    canonical.borders = borders;
  }
  if (cell.alignment !== undefined) {
    canonical.alignment = cell.alignment satisfies Alignment;
  }
  if (cell.verticalAlignment !== undefined) {
    canonical.verticalAlignment = cell.verticalAlignment;
  }
  return canonical;
}

function canonicalCells(
  sheet: ContentSheet,
  maxRow: number | undefined,
  maxColumn: number | undefined,
): ContentSheetCell[] {
  if (maxRow === undefined || maxColumn === undefined) {
    return [];
  }
  const cellByPosition = new Map(
    sheet.cells.map((cell) => [coverageKey(cell.row, cell.column), cell]),
  );
  const covered = computeCoveredPositions(sheet.cells);
  const result: ContentSheetCell[] = [];
  for (let row = 0; row <= maxRow; row += 1) {
    for (let column = 0; column <= maxColumn; column += 1) {
      const key = coverageKey(row, column);
      if (covered.has(key)) {
        continue;
      }
      const cell = cellByPosition.get(key);
      if (cell === undefined) {
        continue;
      }
      const canonical = canonicalCell(cell);
      if (canonical !== undefined) {
        result.push(canonical);
      }
    }
  }
  return result;
}

// Dense from 0 to maxColumn/maxRow, an undeclared position stamped with readColumnLayout/readRowLayout's own DEFAULT_COLUMN_WIDTH_PT/DEFAULT_ROW_HEIGHT_PT default -- ContentSheetColumn/RowSchema's own "absent widthPt/heightPt means no declared size" cannot be written as a genuinely absent style, since an unstyled table:table-column/-row still resolves to that same reader-side default. A sparse input `columns`/`rows` array is therefore densified on the round trip, one entry per position, exactly as this writer's own dense table:table-column/-row output reads back.
function canonicalColumns(
  sheet: ContentSheet,
  maxColumn: number | undefined,
): ContentSheetColumn[] {
  if (maxColumn === undefined) {
    return [];
  }
  const byIndex = new Map(
    sheet.columns.map((column) => [column.index, column]),
  );
  const result: ContentSheetColumn[] = [];
  for (let index = 0; index <= maxColumn; index += 1) {
    const declared = byIndex.get(index);
    result.push({
      index,
      widthPt: declared?.widthPt ?? DEFAULT_COLUMN_WIDTH_PT,
      hidden: declared?.hidden === true ? true : undefined,
    });
  }
  return result;
}

function canonicalRows(
  sheet: ContentSheet,
  maxRow: number | undefined,
): ContentSheetRow[] {
  if (maxRow === undefined) {
    return [];
  }
  const byIndex = new Map(sheet.rows.map((row) => [row.index, row]));
  const result: ContentSheetRow[] = [];
  for (let index = 0; index <= maxRow; index += 1) {
    const declared = byIndex.get(index);
    result.push({
      index,
      heightPt: declared?.heightPt ?? DEFAULT_ROW_HEIGHT_PT,
      hidden: declared?.hidden === true ? true : undefined,
    });
  }
  return result;
}

function canonicalSheetImage(image: ContentSheetImage): ContentSheetImage {
  const canonical: ContentSheetImage = {
    kind: "image",
    format: image.format,
    base64: image.base64,
    widthPt: image.widthPt,
    heightPt: image.heightPt,
    anchorRow: image.anchorRow,
    anchorColumn: image.anchorColumn,
    offsetXPt: image.offsetXPt,
    offsetYPt: image.offsetYPt,
  };
  if (image.altText !== undefined) {
    canonical.altText = image.altText;
  }
  return canonical;
}

// Images read back in row-major anchor-position document order (top-to-bottom, then left-to-right), the order readTable's own cell walk discovers them in -- never the input array's own order, which this writer's per-position placement does not preserve when several images share no ordering relationship across positions.
function canonicalImages(sheet: ContentSheet): ContentSheetImage[] {
  return sheet.images
    .map((image, originalIndex) => ({ image, originalIndex }))
    .sort(
      (a, b) =>
        a.image.anchorRow - b.image.anchorRow ||
        a.image.anchorColumn - b.image.anchorColumn ||
        a.originalIndex - b.originalIndex,
    )
    .map(({ image }) => canonicalSheetImage(image));
}

function canonicalPrintSettings(
  printSettings: ContentSheetPrintSettings,
): ContentSheetPrintSettings {
  const canonical: ContentSheetPrintSettings = {
    pageSize: printSettings.pageSize,
    margins: printSettings.margins,
    gridlines: printSettings.gridlines,
    headers: printSettings.headers,
    pageOrder: printSettings.pageOrder,
  };
  if (printSettings.printRange !== undefined) {
    canonical.printRange = printSettings.printRange;
  }
  if (printSettings.scalePercent !== undefined) {
    canonical.scalePercent = printSettings.scalePercent;
  }
  if (printSettings.fitToPages !== undefined) {
    canonical.fitToPages = printSettings.fitToPages;
  }
  if (printSettings.repeatRows !== undefined) {
    canonical.repeatRows = printSettings.repeatRows;
  }
  if (printSettings.repeatColumns !== undefined) {
    canonical.repeatColumns = printSettings.repeatColumns;
  }
  if (printSettings.manualBreaks !== undefined) {
    canonical.manualBreaks = printSettings.manualBreaks;
  }
  return canonical;
}

function canonicalSheet(sheet: ContentSheet): ContentSheet {
  const { maxRow, maxColumn } = computeUsedRange(sheet);
  const canonical: ContentSheet = {
    name: sheet.name,
    cells: canonicalCells(sheet, maxRow, maxColumn),
    columns: canonicalColumns(sheet, maxColumn),
    rows: canonicalRows(sheet, maxRow),
    images: canonicalImages(sheet),
    printSettings: canonicalPrintSettings(sheet.printSettings),
  };
  return canonical;
}

// The one canonical ContentDocument a written-and-reread document equals -- the exact statement of what this writer preserves and what ODF (or this package's own reader) cannot carry back, mirroring typed/odt/write.ts's own normaliseOdtContent in both role and discipline. What it restates, each forced by the format or by readOdsContent's own established behaviour rather than chosen here:
// - CELLS carrying no formula, no value-bearing office:value-type, and no rendered text vanish entirely (canonicalCell's own note); every surviving cell's runs are re-segmented through the identical ODF inline-content rules typed/shared/paragraph.ts already establishes, and a bare "\n" run boundary becomes a genuine text:p split rather than a text:line-break (canonicalCellRuns' own note).
// - COLUMNS/ROWS densify to one entry per position across the sheet's used range, an undeclared width/height stamped with readOdsContent's own DEFAULT_COLUMN_WIDTH_PT/DEFAULT_ROW_HEIGHT_PT default rather than staying absent (canonicalColumns/canonicalRows' own note).
// - IMAGES reorder into row-major anchor-position document order (canonicalImages' own note).
// - A cell's numeric exactValue, comment, sourcePath, and source never survive -- readOdsContent has no field for the first three on write-back and residue is a deliberate, documented drop (this module's own top-of-file note); a 'time' cell's ISO clock value becomes the raw xsd:duration string readOdsContent carries through unconverted (this module's own top-of-file note on that one forced, pre-existing asymmetry).
// - The sheet-level `source` residue and any `embeddedObjects`/`dataValidations`/`conditionalFormats` are refused outright by the writer itself (writeSheet throws before producing a Package for one), so a document reaching this canonicaliser never carries them in the first place.
export function normaliseOdsContent(
  document: ContentDocument,
): Extract<ContentDocument, { kind: "spreadsheet" }> {
  if (document.kind !== "spreadsheet") {
    throw new Error(
      `normaliseOdsContent: expected a 'spreadsheet' document, got '${document.kind}'`,
    );
  }
  return {
    kind: "spreadsheet",
    metadata: document.metadata,
    sheets: document.sheets.map(canonicalSheet),
  };
}

// --- the writer -----------------------------------------------------------------------------------------------------

export function writeOdsContent(
  document: ContentDocument,
  options: OdsWriteOptions = {},
): Package {
  if (document.kind !== "spreadsheet") {
    throw new Error(
      `writeOdsContent: expected a 'spreadsheet' document, got '${document.kind}' -- odf.js writes .ods from the spreadsheet arm only`,
    );
  }
  const version = options.version ?? DEFAULT_ODF_VERSION;
  const spreadsheetElement = el("office:spreadsheet");
  const pkg = createOdfPackage(
    options.template ? ODF_MEDIA_TYPES.ots : ODF_MEDIA_TYPES.ods,
    spreadsheetElement,
    version,
  );

  const state: OdsWriteState = {
    pkg,
    registry: StyleRegistry.forPart(pkg, CONTENT_PART, {
      otherPart: { pkg, partPath: STYLES_PART },
    }),
    contentAutomaticStyles: odfPartContainer(
      pkg,
      CONTENT_PART,
      "office:automatic-styles",
    ),
    stylesAutomaticStyles: odfPartContainer(
      pkg,
      STYLES_PART,
      "office:automatic-styles",
    ),
    masterStyles: odfPartContainer(pkg, STYLES_PART, "office:master-styles"),
    nextImage: 1,
    nextZIndex: 0,
    nextSheetStyle: 1,
  };

  for (const sheet of document.sheets) {
    spreadsheetElement.children.push(writeSheet(sheet, state));
  }

  writeOdfMetadata(pkg, document.metadata, version);
  syncManifest(pkg, { version });
  return pkg;
}

// DocumentTree -> a real .ods Package: this module's PRIMARY entry point, and the exact mirror of writeOdt's own relationship to writeOdtContent. The tree is flattened through document-schema.js's own flattenTree, so a tree read from one .ods and written back out crosses the package boundary exactly once in each direction, with every style ref resolved on the way out.
export function writeOds(
  document: DocumentTree,
  options: OdsWriteOptions = {},
): Package {
  return writeOdsContent(flattenTree(document), options);
}
