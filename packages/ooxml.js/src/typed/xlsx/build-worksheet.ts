import {
  BOOLEAN_NUMBER_FORMAT,
  DATE_NUMBER_FORMAT,
  DATE_TIME_NUMBER_FORMAT,
  PERCENTAGE_NUMBER_FORMAT,
  TIME_NUMBER_FORMAT,
  currencyNumberFormat,
} from "./number-format";
import {
  COLUMN_WIDTH_CHARS_DECIMAL_PLACES,
  ptToColumnWidthChars,
} from "./units";
import { type CellFormatTable, GENERAL_NUM_FMT_ID } from "./styles";
import type { CellNumberFormat } from "./number-format";
import type {
  ContentCellValue,
  ContentSheet,
  ContentSheetCell,
  ContentSheetColumn,
  ContentSheetPrintSettings,
  ContentSheetRow,
} from "document-schema.js";
import { DEFAULT_HEADER_FOOTER_MARGIN_PT } from "./print-settings";
import {
  buildConditionalFormattingElements,
  type DxfTable,
} from "./conditional-format-write";
import {
  MAX_COLUMN_INDEX,
  MAX_ROW_INDEX,
  PKG_RELS_NS,
  REL_NS,
  SML_NS,
  xmlPart,
} from "./build";
import { POINTS_PER_INCH } from "../shared/units";
import { type SharedStringTable } from "./shared-strings";
import type { XmlElement, XmlNode } from "../../model/node";
import type { XmlPart } from "../../model/package";
import { buildDataValidationsElement } from "./data-validation";
import { cellReference, rangeReference } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import {
  isoDateTimeToSerial,
  isoDateToSerial,
  isoTimeToSerial,
} from "./serial";
import {
  pageSizeToPaperSizeCode,
  ptToUniversalMeasure,
  writeXmlBool,
} from "./util";
// The worksheet-part family of the xlsx writer, split from build.ts: dimension, column widths, cell rendering (values, strings, temporals), sheet data, merges, sheet/print/page setup, breaks and the worksheet part with its relationships. build.ts keeps the workbook-level parts and the package assembly.
// --- xl/worksheets/sheetN.xml ------------------------------------------------------------------------------------

export function computeDimension(sheet: ContentSheet): string {
  let maxRow = 0;
  let maxColumn = 0;
  let hasAny = false;
  for (const cell of sheet.cells) {
    hasAny = true;
    maxRow = Math.max(maxRow, cell.row);
    maxColumn = Math.max(maxColumn, cell.column);
  }
  for (const column of sheet.columns) {
    hasAny = true;
    maxColumn = Math.max(maxColumn, column.index);
  }
  for (const row of sheet.rows) {
    hasAny = true;
    maxRow = Math.max(maxRow, row.index);
  }
  return hasAny
    ? rangeReference({
        startRow: 0,
        startColumn: 0,
        endRow: maxRow,
        endColumn: maxColumn,
      })
    : "A1";
}

export function buildColsElement(
  columns: readonly ContentSheetColumn[],
): XmlElement | undefined {
  if (columns.length === 0) {
    return undefined;
  }
  // One <col min max> range per ContentSheetColumn, min=max=that single column — the honest inverse of readColumns' own "one entry per <col> element, never per repeated position" policy: this writer never attempts to re-merge adjacent same-width columns back into a wider range, which would be a real optimization but isn't needed for a correct, valid file. widthPt is optional (a column entry can exist purely to declare `hidden`, with no declared size at all) — width/customWidth are only written when a real width is present, matching ECMA-376's own optional CT_Col@width/@customWidth rather than fabricating a zero-width column.
  const colElements = columns.map((column) => {
    const attrs: Record<string, string> = {
      min: String(column.index + 1),
      max: String(column.index + 1),
    };
    if (column.widthPt !== undefined) {
      attrs.width = ptToColumnWidthChars(column.widthPt).toFixed(
        COLUMN_WIDTH_CHARS_DECIMAL_PLACES,
      );
      attrs.customWidth = "true";
    }
    if (column.hidden === true) {
      attrs.hidden = "true";
    }
    return el("col", attrs);
  });
  return el("cols", {}, colElements);
}

export interface RenderedCellValue {
  // ST_CellType, absent for the "this cell holds a number" case (an absent t and t="n" are identical, and every temporal/percentage/currency value below is a number as far as the wire format is concerned).
  type?: string;
  content: string;
  // The number format this value must be DISPLAYED through, interned by the caller into the workbook's own cell-format table. Absent means General, i.e. cellXfs index 0.
  format?: CellNumberFormat;
}

// xlsx has no distinct CELL TYPE for a percentage, an amount of money, a date, or a time — every one of them is an ordinary number whose meaning lives entirely in the number format its style points at, which is exactly how typed/xlsx/content.ts recovers them on the way in. So this writer says what it means the same way a real producer does: it renders the value as a bare number and asks for the matching format from typed/xlsx/number-format.ts's own write-side vocabulary, which the CellFormatTable interns into a real <numFmt>/<xf> pair.
//
// ST_CellType's rare t="d" ISO-8601 variant is deliberately NOT used for the temporal kinds, even though it would carry their string spelling verbatim: real Excel does not render it as a date at all, and it is a SINGLE combined date-and-time type, so writing all three temporal kinds through it collapses them onto one indistinguishable wire form that reads back as 'dateTime' whatever went in. A serial plus a date/time/dateTime format is both what real files carry and what keeps the three kinds distinguishable.
// Reached only if ContentCellValue ever gains a variant renderCellValue's own switch does not match: every current member is covered there, so `value` narrows to `never` at the real call site, and adding an uncovered kind makes that narrowing fail and this call stop compiling. That is the real safety net. Exported so build.test.ts can exercise the throw directly with a forced-invalid cast: it is otherwise unreachable, since every real ContentCellValue kind is already handled by a case in renderCellValue.
export function assertNeverContentCellValueKind(value: never): never {
  throw new Error(
    `renderCellValue: unhandled ContentCellValue kind ${JSON.stringify(value)}`,
  );
}

export function renderCellValue(
  value: ContentCellValue,
  isFormulaResult: boolean,
  sharedStrings: SharedStringTable,
): RenderedCellValue | undefined {
  switch (value.kind) {
    case "string":
      return renderString(value.value, isFormulaResult, sharedStrings);
    case "number":
      return { content: String(value.value) };
    case "percentage":
      // The stored value stays the raw fraction ContentCellValue carries (0.4256), which is what a percent-formatted cell holds in every real file — the x100 is the format's job, not the value's.
      return { content: String(value.value), format: PERCENTAGE_NUMBER_FORMAT };
    case "currency":
      return {
        content: String(value.value),
        format: currencyNumberFormat(value.currency),
      };
    case "boolean":
      return {
        type: "b",
        content: value.value ? "1" : "0",
        format: BOOLEAN_NUMBER_FORMAT,
      };
    case "date":
      return renderTemporal(
        isoDateToSerial(value.value),
        value.value,
        DATE_NUMBER_FORMAT,
        isFormulaResult,
        sharedStrings,
      );
    case "time":
      return renderTemporal(
        isoTimeToSerial(value.value),
        value.value,
        TIME_NUMBER_FORMAT,
        isFormulaResult,
        sharedStrings,
      );
    case "dateTime":
      return renderTemporal(
        isoDateTimeToSerial(value.value),
        value.value,
        DATE_TIME_NUMBER_FORMAT,
        isFormulaResult,
        sharedStrings,
      );
    case "error":
      return { type: "e", content: encodeXmlText(value.value) };
    case "empty":
      return undefined;
  }
  return assertNeverContentCellValueKind(value);
}

export function renderString(
  text: string,
  isFormulaResult: boolean,
  sharedStrings: SharedStringTable,
): RenderedCellValue {
  if (isFormulaResult) {
    // A formula's own cached string result is written literally (t="str"), never shared-string indexed — shared strings are ECMA-376's own convention for literal, non-formula text cells only; a formula's cached text result is written inline instead, mirroring exactly how typed/xlsx/content.ts's readCellValue reads the two cases apart.
    return { type: "str", content: encodeXmlText(text) };
  }
  return { type: "s", content: String(sharedStrings.intern(text)) };
}

// A temporal value whose ISO spelling could not be converted to a serial at all — a value that is not the canonical ContentCellValue spelling (see typed/xlsx/serial.ts), or one naming a moment with no serial (a date before the epoch, an impossible calendar day, an hour past 23) — degrades to an ordinary text cell carrying that original string VERBATIM. Writing a fabricated or clamped serial would silently turn an unreadable value into a plausible wrong one; writing the text keeps every character the caller supplied, visibly as text.
export function renderTemporal(
  serial: number | undefined,
  iso: string,
  format: CellNumberFormat,
  isFormulaResult: boolean,
  sharedStrings: SharedStringTable,
): RenderedCellValue {
  if (serial === undefined) {
    return renderString(iso, isFormulaResult, sharedStrings);
  }
  return { content: String(serial), format };
}

export function buildCellElement(
  cell: ContentSheetCell,
  sharedStrings: SharedStringTable,
  cellFormats: CellFormatTable,
): XmlElement {
  const children: XmlNode[] = [];
  const rendered = renderCellValue(
    cell.value,
    cell.formula !== undefined,
    sharedStrings,
  );
  // The cell's own font and decoration (font/background/borders/alignment/verticalAlignment) is interned INTO the same cellXfs index as its number format, so two cells sharing format, font, and decoration share one <xf> entry exactly as a real producer's own output does. No presence guard ahead of this: an undecorated cell's {font: undefined, background: undefined, ...} object produces the identical signature signatureOfDecoration derives from {}, so cellFormats.intern's own signature cache already lands it on the same default xf an identical-format undecorated cell gets — a separate early return spelled that fact a second time rather than observing anything intern() does not already guarantee.
  const decoration = {
    font: cell.font,
    background: cell.background,
    borders: cell.borders,
    alignment: cell.alignment,
    verticalAlignment: cell.verticalAlignment,
  };
  const format = rendered?.format;
  const styleIndex = cellFormats.intern(
    format ?? { kind: "builtin", id: GENERAL_NUM_FMT_ID },
    decoration,
  );
  const attrs: Record<string, string> = {
    r: cellReference(cell.row, cell.column),
    s: String(styleIndex),
  };
  if (cell.formula !== undefined) {
    children.push(el("f", {}, [txt(encodeXmlText(cell.formula))]));
  }
  if (rendered !== undefined) {
    if (rendered.type !== undefined) {
      attrs.t = rendered.type;
    }
    children.push(el("v", {}, [txt(rendered.content)]));
  }
  return el("c", attrs, children);
}

export function buildSheetDataElement(
  sheet: ContentSheet,
  sharedStrings: SharedStringTable,
  cellFormats: CellFormatTable,
): XmlElement {
  const cellsByRow = new Map<number, ContentSheetCell[]>();
  for (const cell of sheet.cells) {
    const existing = cellsByRow.get(cell.row);
    if (existing === undefined) {
      cellsByRow.set(cell.row, [cell]);
    } else {
      existing.push(cell);
    }
  }
  const rowInfoByIndex = new Map<number, ContentSheetRow>();
  for (const row of sheet.rows) {
    rowInfoByIndex.set(row.index, row);
  }
  const rowIndices = Array.from(
    new Set<number>([...cellsByRow.keys(), ...rowInfoByIndex.keys()]),
  ).sort((a, b) => a - b);

  const rowElements = rowIndices.map((rowIndex) => {
    const cells = (cellsByRow.get(rowIndex) ?? [])
      .slice()
      .sort((a, b) => a.column - b.column);
    const rowInfo = rowInfoByIndex.get(rowIndex);
    const attrs: Record<string, string> = { r: String(rowIndex + 1) };
    if (rowInfo !== undefined) {
      if (rowInfo.heightPt !== undefined) {
        attrs.ht = String(rowInfo.heightPt);
        attrs.customHeight = "true";
      }
      if (rowInfo.hidden === true) {
        attrs.hidden = "true";
      }
    }
    return el(
      "row",
      attrs,
      cells.map((cell) => buildCellElement(cell, sharedStrings, cellFormats)),
    );
  });
  return el("sheetData", {}, rowElements);
}

export function buildMergeCellsElement(
  cells: readonly ContentSheetCell[],
): XmlElement | undefined {
  const merges = cells.filter(
    (cell) => (cell.colSpan ?? 1) > 1 || (cell.rowSpan ?? 1) > 1,
  );
  if (merges.length === 0) {
    return undefined;
  }
  const mergeCellElements = merges.map((cell) => {
    const endRow = cell.row + (cell.rowSpan ?? 1) - 1;
    const endColumn = cell.column + (cell.colSpan ?? 1) - 1;
    return el("mergeCell", {
      ref: rangeReference({
        startRow: cell.row,
        startColumn: cell.column,
        endRow,
        endColumn,
      }),
    });
  });
  return el(
    "mergeCells",
    { count: String(mergeCellElements.length) },
    mergeCellElements,
  );
}

export function buildSheetPrElement(
  settings: ContentSheetPrintSettings,
): XmlElement {
  return el("sheetPr", {}, [
    el("pageSetUpPr", {
      fitToPage: writeXmlBool(settings.fitToPages !== undefined),
    }),
  ]);
}

export function buildPrintOptionsElement(
  settings: ContentSheetPrintSettings,
): XmlElement {
  return el("printOptions", {
    gridLines: writeXmlBool(settings.gridlines),
    headings: writeXmlBool(settings.headers),
  });
}

export function ptToInches(pt: number): string {
  return String(pt / POINTS_PER_INCH);
}

export function buildPageMarginsElement(
  settings: ContentSheetPrintSettings,
): XmlElement {
  const margins = settings.margins;
  return el("pageMargins", {
    left: ptToInches(margins.leftPt),
    right: ptToInches(margins.rightPt),
    top: ptToInches(margins.topPt),
    bottom: ptToInches(margins.bottomPt),
    header: ptToInches(DEFAULT_HEADER_FOOTER_MARGIN_PT),
    footer: ptToInches(DEFAULT_HEADER_FOOTER_MARGIN_PT),
  });
}

// pageSetup@scale's own schema default: no scaling at all.
export const DEFAULT_SCALE_PERCENT = 100;

export function buildPageSetupElement(
  settings: ContentSheetPrintSettings,
): XmlElement {
  const attrs: Record<string, string> = {};
  const paperCode = pageSizeToPaperSizeCode(settings.pageSize);
  if (paperCode !== undefined) {
    attrs.paperSize = paperCode;
  } else {
    attrs.paperWidth = ptToUniversalMeasure(settings.pageSize.widthPt);
    attrs.paperHeight = ptToUniversalMeasure(settings.pageSize.heightPt);
  }
  // scale/fitToWidth/fitToHeight are written together regardless of which mode sheetPr/pageSetUpPr@fitToPage actually selects — matching real producer output (see this directory's own kitchen-sink fixture, where LibreOffice writes all three unconditionally, only one pair of them ever meaningfully honoured).
  attrs.scale = String(settings.scalePercent ?? DEFAULT_SCALE_PERCENT);
  attrs.fitToWidth = String(settings.fitToPages?.width ?? 1);
  attrs.fitToHeight = String(settings.fitToPages?.height ?? 1);
  attrs.pageOrder = settings.pageOrder;
  // ContentSheetPrintSettings carries no explicit print-orientation field of its own — PageSize's own width-vs-height already encodes it (a landscape page style's own recorded width exceeds its height), the same relationship typed/xlsx/print-settings.ts's own readPageSize swaps back on the way in when pageSetup@orientation="landscape" is present, so this is a real, non-fabricated derivation, not an assumption.
  attrs.orientation =
    settings.pageSize.widthPt > settings.pageSize.heightPt
      ? "landscape"
      : "portrait";
  return el("pageSetup", attrs);
}

export function buildBreaksElements(settings: ContentSheetPrintSettings): {
  rowBreaks?: XmlElement;
  colBreaks?: XmlElement;
} {
  const manualBreaks = settings.manualBreaks;
  if (manualBreaks === undefined) {
    return {};
  }
  const result: { rowBreaks?: XmlElement; colBreaks?: XmlElement } = {};
  if (manualBreaks.rows.length > 0) {
    const breaks = manualBreaks.rows.map((id) =>
      el("brk", {
        id: String(id),
        min: "0",
        max: String(MAX_COLUMN_INDEX),
        man: "1",
      }),
    );
    result.rowBreaks = el(
      "rowBreaks",
      { count: String(breaks.length), manualBreakCount: String(breaks.length) },
      breaks,
    );
  }
  if (manualBreaks.columns.length > 0) {
    const breaks = manualBreaks.columns.map((id) =>
      el("brk", {
        id: String(id),
        min: "0",
        max: String(MAX_ROW_INDEX),
        man: "1",
      }),
    );
    result.colBreaks = el(
      "colBreaks",
      { count: String(breaks.length), manualBreakCount: String(breaks.length) },
      breaks,
    );
  }
  return result;
}

export interface WorksheetRelationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
}

// A worksheet part only ever needs its own .rels when something on the sheet relates to a sibling part outside xl/worksheets/ — a commented cell (sheetHasComments, comments-write.ts), a drawing layer carrying at least one image or chart (typed/xlsx/drawings-write.ts), or a Table/List object anchored to it (typed/xlsx/definitions-write.ts) — addressed by the SAME relative-target convention typed/xlsx/util.ts's own resolveRelTarget already resolves back through.
export function buildWorksheetRelsPart(
  relationships: readonly WorksheetRelationship[],
): XmlPart {
  const root = el(
    "Relationships",
    { xmlns: PKG_RELS_NS },
    relationships.map((rel) =>
      el("Relationship", { Id: rel.id, Type: rel.type, Target: rel.target }),
    ),
  );
  return xmlPart(root);
}

// CT_Worksheet's own required child element ORDER (ECMA-376 Part 1 SS18.3.1.99): sheetPr?, dimension?, sheetViews?, sheetFormatPr?, cols*, sheetData, ..., mergeCells?, conditionalFormatting*, dataValidations?, ..., printOptions?, pageMargins?, pageSetup?, headerFooter?, rowBreaks?, colBreaks?, ..., drawing?, ..., tableParts?, extLst? — every element this writer emits follows that relative order (sheetViews and headerFooter are both skipped entirely: pure UI/print-preview state this package's own content model carries no data for), confirmed against real-producer-validation-and-cellis.xlsx's own emitted order: mergeCells (this fixture has none), conditionalFormatting, dataValidations, printOptions/pageMargins/pageSetup. drawing (typed/xlsx/drawings-write.ts) and tableParts (typed/xlsx/definitions-write.ts) both sit past colBreaks, drawing first, matching CT_Worksheet's own sequence.
export function buildWorksheetPart(
  sheet: ContentSheet,
  sharedStrings: SharedStringTable,
  cellFormats: CellFormatTable,
  dxfTable: DxfTable,
  drawingRelId: string | undefined,
  tableRelIds: readonly string[],
): XmlPart {
  const children: XmlElement[] = [
    buildSheetPrElement(sheet.printSettings),
    el("dimension", { ref: computeDimension(sheet) }),
  ];

  const colsElement = buildColsElement(sheet.columns);
  if (colsElement !== undefined) {
    children.push(colsElement);
  }

  children.push(buildSheetDataElement(sheet, sharedStrings, cellFormats));

  const mergeCellsElement = buildMergeCellsElement(sheet.cells);
  if (mergeCellsElement !== undefined) {
    children.push(mergeCellsElement);
  }

  children.push(
    ...buildConditionalFormattingElements(
      sheet.conditionalFormats ?? [],
      dxfTable,
    ),
  );

  const dataValidationsElement = buildDataValidationsElement(
    sheet.dataValidations ?? [],
  );
  if (dataValidationsElement !== undefined) {
    children.push(dataValidationsElement);
  }

  children.push(
    buildPrintOptionsElement(sheet.printSettings),
    buildPageMarginsElement(sheet.printSettings),
    buildPageSetupElement(sheet.printSettings),
  );

  const { rowBreaks, colBreaks } = buildBreaksElements(sheet.printSettings);
  if (rowBreaks !== undefined) {
    children.push(rowBreaks);
  }
  if (colBreaks !== undefined) {
    children.push(colBreaks);
  }

  if (drawingRelId !== undefined) {
    children.push(el("drawing", { "r:id": drawingRelId }));
  }

  if (tableRelIds.length > 0) {
    children.push(
      el(
        "tableParts",
        { count: String(tableRelIds.length) },
        tableRelIds.map((relId) => el("tablePart", { "r:id": relId })),
      ),
    );
  }

  const root = el("worksheet", { xmlns: SML_NS, "xmlns:r": REL_NS }, children);
  return xmlPart(root);
}
