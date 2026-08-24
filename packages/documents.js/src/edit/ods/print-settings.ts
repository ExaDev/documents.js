import type { Package, XmlElement, XmlNode } from "odf.js";
import {
  findStyleElement,
  formatOdfLength,
  parseMargins,
  parsePageSize,
  resolvePageLayoutProperties,
} from "odf.js";
import { cellReference, parseCellReference } from "document-schema.js";
import { attr } from "ooxml.js";
import type {
  ContentSheetPrintRange,
  ContentSheetPrintSettings,
  ContentSheetRepeatRange,
} from "document-schema.js";
import type { Margins } from "document-schema.js";
import { PAGE_SIZE_A4 } from "document-schema.js";
import { setAttr } from "../../xml/edit";
import { el } from "../../xml/fragment";
import { nextStyleName } from "../odt/automatic-styles";
import {
  COLUMN_REPEAT_ATTR,
  COLUMN_TAG,
  HEADER_COLUMNS_TAG,
  HEADER_ROWS_TAG,
  ROW_REPEAT_ATTR,
  ROW_TAG,
  isElementWithTag,
  readRunRepeatCount,
  replaceRun,
} from "./address";
import {
  ensureColumnElementDefaultWidth,
  ensureRowElementDefaultHeight,
  writeColumnManualBreak,
  writeRowManualBreak,
} from "./column-row";

const STYLES_PART_PATH = "styles.xml";
const CONTENT_PART_PATH = "content.xml";

function findRoot(pkg: Package, partPath: string): XmlElement {
  const part = pkg.parts[partPath];
  const root =
    part?.kind === "xml"
      ? part.nodes.find((n): n is XmlElement => n.type === "element")
      : undefined;
  if (root === undefined) {
    throw new Error(`package has no root element at ${partPath}`);
  }
  return root;
}

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  for (const child of parent.children) {
    if (child.type === "element" && child.tag === tag) {
      return child;
    }
  }
  return undefined;
}

// styles.xml's own office:automatic-styles/office:master-styles and content.xml's own office:automatic-styles are guaranteed to already exist on any package this editor's own createEmptyOdsPackage scaffolded (scaffold.ts's buildStylesXml/buildContentXml both create them unconditionally) -- so, unlike odt/automatic-styles.ts's own ensureAutomaticStyles (which DOES need create-if-missing logic, since a docx-derived package's own content.xml has no such guarantee), a plain find-or-throw is enough here.
function findStylesAutomaticStyles(pkg: Package): XmlElement {
  const found = directChild(
    findRoot(pkg, STYLES_PART_PATH),
    "office:automatic-styles",
  );
  if (found === undefined) {
    throw new Error(
      `${STYLES_PART_PATH} has no office:automatic-styles element`,
    );
  }
  return found;
}

function findMasterStyles(pkg: Package): XmlElement {
  const found = directChild(
    findRoot(pkg, STYLES_PART_PATH),
    "office:master-styles",
  );
  if (found === undefined) {
    throw new Error(`${STYLES_PART_PATH} has no office:master-styles element`);
  }
  return found;
}

function findContentAutomaticStyles(pkg: Package): XmlElement {
  const found = directChild(
    findRoot(pkg, CONTENT_PART_PATH),
    "office:automatic-styles",
  );
  if (found === undefined) {
    throw new Error(
      `${CONTENT_PART_PATH} has no office:automatic-styles element`,
    );
  }
  return found;
}

// 2cm in points -- LibreOffice Calc's own real out-of-the-box default page margin, matching scaffold.ts's own DEFAULT_MARGIN and its identical justification there. Used only as readSheetPrintSettings' own fallback for the pathological case of a table:table whose own style chain fails to resolve a page-layout at all -- never true for a package this editor itself built, since addSheet/writeSheetPrintSettings always mint one.
const DEFAULT_MARGIN_PT = 56.69291338582677;
const DEFAULT_MARGINS: Margins = {
  topPt: DEFAULT_MARGIN_PT,
  rightPt: DEFAULT_MARGIN_PT,
  bottomPt: DEFAULT_MARGIN_PT,
  leftPt: DEFAULT_MARGIN_PT,
};

// --- repeatColumns/repeatRows/manualBreak* cursor tracking -------------------------------------
//
// Mirrors odf.js's own private readTable (typed/ods/read.ts) exactly for the structural walk it does BEFORE ever calling its own readPrintSettings: a running columnCursor/rowCursor incremented by each table:table-column/table:table-row's own repeat count, with a table:table-header-columns/table:table-header-rows wrapper recorded as a { start, end } range spanning whatever it covers. This file does not need readTable's own cell-level TableCursor at all (no cells are read here), only the column/row structural cursor -- so this is a scoped-down mirror of that one piece, not the whole function.

interface TableStructure {
  readonly repeatColumns: ContentSheetRepeatRange | undefined;
  readonly repeatRows: ContentSheetRepeatRange | undefined;
  readonly manualBreakColumns: number[];
  readonly manualBreakRows: number[];
}

function hasManualBreak(
  pkg: Package,
  element: XmlElement,
  family: "table-column" | "table-row",
  propertiesTag: string,
): boolean {
  const styleName = attr(element, "table:style-name");
  const styleElement =
    styleName === undefined
      ? undefined
      : findStyleElement(styleName, family, pkg);
  const properties =
    styleElement === undefined
      ? undefined
      : directChild(styleElement, propertiesTag);
  return (
    properties !== undefined && attr(properties, "fo:break-before") === "page"
  );
}

// Mirrors odf.js's readTable: walks tableElement's direct children in document order, tracking a running column cursor and row cursor exactly as that function does, recording a table:table-header-columns/table:table-header-rows wrapper's own [start, end] span (repeatColumns/repeatRows) and every manual-break column/row's own start index (a break on a repeated run only ever applies to the run's FIRST position, matching readTable's own `manualBreakColumns.push(columnCursor)`/`manualBreakRows.push(startIndex)`).
function scanTableStructure(
  pkg: Package,
  tableElement: XmlElement,
): TableStructure {
  let columnCursor = 0;
  let rowCursor = 0;
  let repeatColumns: ContentSheetRepeatRange | undefined;
  let repeatRows: ContentSheetRepeatRange | undefined;
  const manualBreakColumns: number[] = [];
  const manualBreakRows: number[] = [];

  function processColumn(columnElement: XmlElement): void {
    if (
      hasManualBreak(
        pkg,
        columnElement,
        "table-column",
        "style:table-column-properties",
      )
    ) {
      manualBreakColumns.push(columnCursor);
    }
    columnCursor += readRunRepeatCount(columnElement, COLUMN_REPEAT_ATTR);
  }

  function processRow(rowElement: XmlElement): void {
    const startIndex = rowCursor;
    if (
      hasManualBreak(pkg, rowElement, "table-row", "style:table-row-properties")
    ) {
      manualBreakRows.push(startIndex);
    }
    rowCursor += readRunRepeatCount(rowElement, ROW_REPEAT_ATTR);
  }

  for (const child of tableElement.children) {
    if (child.type !== "element") {
      continue;
    }
    if (child.tag === COLUMN_TAG) {
      processColumn(child);
    } else if (child.tag === HEADER_COLUMNS_TAG) {
      const startIndex = columnCursor;
      for (const headerChild of child.children) {
        if (headerChild.type === "element" && headerChild.tag === COLUMN_TAG) {
          processColumn(headerChild);
        }
      }
      if (columnCursor > startIndex) {
        repeatColumns = { start: startIndex, end: columnCursor - 1 };
      }
    } else if (child.tag === ROW_TAG) {
      processRow(child);
    } else if (child.tag === HEADER_ROWS_TAG) {
      const startIndex = rowCursor;
      for (const headerChild of child.children) {
        if (headerChild.type === "element" && headerChild.tag === ROW_TAG) {
          processRow(headerChild);
        }
      }
      if (rowCursor > startIndex) {
        repeatRows = { start: startIndex, end: rowCursor - 1 };
      }
    }
  }

  return { repeatColumns, repeatRows, manualBreakColumns, manualBreakRows };
}

// --- printRange (table:print-ranges) parsing/formatting ----------------------------------------
//
// Mirrors odf.js's own private parsePrintRanges/parseA1WithOptionalSheetPrefix (typed/ods/read.ts): table:print-ranges can carry several space-separated ranges, but ContentSheetPrintSettings.printRange is a single range, so -- exactly like odf.js's own reader -- only the FIRST is read; a cell reference may carry an optional "SheetName." prefix, stripped before parsing.

function parseA1WithOptionalSheetPrefix(
  cellPart: string,
): { column: number; row: number } | undefined {
  const dotIndex = cellPart.lastIndexOf(".");
  const bareReference =
    dotIndex === -1 ? cellPart : cellPart.slice(dotIndex + 1);
  return parseCellReference(bareReference);
}

function parsePrintRanges(value: string): ContentSheetPrintRange | undefined {
  const first = value.split(" ").find((part) => part.length > 0);
  if (first === undefined) {
    return undefined;
  }
  const separatorIndex = first.indexOf(":");
  if (separatorIndex === -1) {
    return undefined;
  }
  const start = parseA1WithOptionalSheetPrefix(first.slice(0, separatorIndex));
  const end = parseA1WithOptionalSheetPrefix(first.slice(separatorIndex + 1));
  if (start === undefined || end === undefined) {
    return undefined;
  }
  return {
    startRow: start.row,
    startColumn: start.column,
    endRow: end.row,
    endColumn: end.column,
  };
}

// The write-side inverse of parsePrintRanges above: "SheetName.A1:SheetName.D10", the exact shape odf.js's own reader (and real LibreOffice output) expects. Requires tableElement to already carry a table:name (true for every sheet this editor creates -- OdsEditor.addSheet always sets it before returning the OdsSheet a caller could reach writeSheetPrintSettings through).
function formatPrintRange(
  sheetName: string,
  range: ContentSheetPrintRange,
): string {
  const start = `${sheetName}.${cellReference(range.startRow, range.startColumn)}`;
  const end = `${sheetName}.${cellReference(range.endRow, range.endColumn)}`;
  return `${start}:${end}`;
}

// --- scale/fitToPages parsing -------------------------------------------------------------------
//
// Mirrors odf.js's own private parseScalePercentage/parseNonNegativeInteger (typed/ods/read.ts).

function parseScalePercentage(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)%$/.exec(value);
  if (match === null) {
    return undefined;
  }
  const numeric = match[1];
  return numeric === undefined ? undefined : Number(numeric);
}

function parseNonNegativeInteger(
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

// Mirrors odf.js's own private readPrintSettings (typed/ods/read.ts) for every field ContentSheetPrintSettingsSchema carries: pageSize/margins/gridlines/headers/pageOrder resolve through the table:style-name -> style:style[family="table"] -> style:master-page-name -> style:master-page -> style:page-layout -> style:page-layout-properties chain (odf.js's own exported findStyleElement/resolvePageLayoutProperties/parsePageSize/parseMargins); scale/fitToPages read style:scale-to/style:scale-to-X/style:scale-to-Y off that same page-layout-properties element; printRange reads table:print-ranges directly off tableElement; repeatColumns/repeatRows/manualBreaks come from scanTableStructure above -- the same table-wide repeated-column/row cursor tracking odf.js's own readTable does before ever calling its own readPrintSettings, mirrored rather than reinvented.
export function readSheetPrintSettings(
  pkg: Package,
  tableElement: XmlElement,
): ContentSheetPrintSettings {
  const tableStyleName = attr(tableElement, "table:style-name");
  const tableStyleElement =
    tableStyleName === undefined
      ? undefined
      : findStyleElement(tableStyleName, "table", pkg);
  const masterPageName =
    tableStyleElement === undefined
      ? undefined
      : attr(tableStyleElement, "style:master-page-name");
  const layoutProperties = resolvePageLayoutProperties(pkg, masterPageName);
  const pageSize =
    layoutProperties === undefined
      ? undefined
      : parsePageSize(layoutProperties);
  const margins =
    layoutProperties === undefined ? undefined : parseMargins(layoutProperties);
  const printTokens = new Set(
    (layoutProperties === undefined
      ? undefined
      : attr(layoutProperties, "style:print")
    )
      ?.split(" ")
      .filter((token) => token.length > 0) ?? [],
  );
  const pageOrder =
    (layoutProperties === undefined
      ? undefined
      : attr(layoutProperties, "style:print-page-order")) === "ltr"
      ? ("overThenDown" as const)
      : ("downThenOver" as const);

  const scaleToRaw =
    layoutProperties === undefined
      ? undefined
      : attr(layoutProperties, "style:scale-to");
  const scalePercent =
    scaleToRaw === undefined ? undefined : parseScalePercentage(scaleToRaw);
  const fitWidth = parseNonNegativeInteger(
    layoutProperties === undefined
      ? undefined
      : attr(layoutProperties, "style:scale-to-X"),
  );
  const fitHeight = parseNonNegativeInteger(
    layoutProperties === undefined
      ? undefined
      : attr(layoutProperties, "style:scale-to-Y"),
  );
  const fitToPages =
    fitWidth === undefined || fitHeight === undefined
      ? undefined
      : { width: fitWidth, height: fitHeight };

  const printRangesRaw = attr(tableElement, "table:print-ranges");
  const printRange =
    printRangesRaw === undefined ? undefined : parsePrintRanges(printRangesRaw);

  const { repeatColumns, repeatRows, manualBreakColumns, manualBreakRows } =
    scanTableStructure(pkg, tableElement);
  const manualBreaks =
    manualBreakRows.length > 0 || manualBreakColumns.length > 0
      ? { rows: manualBreakRows, columns: manualBreakColumns }
      : undefined;

  return {
    pageSize: pageSize ?? PAGE_SIZE_A4,
    margins: margins ?? DEFAULT_MARGINS,
    gridlines: printTokens.has("grid"),
    headers: printTokens.has("headers"),
    pageOrder,
    ...(printRange !== undefined ? { printRange } : {}),
    ...(scalePercent !== undefined ? { scalePercent } : {}),
    ...(fitToPages !== undefined ? { fitToPages } : {}),
    ...(repeatRows !== undefined ? { repeatRows } : {}),
    ...(repeatColumns !== undefined ? { repeatColumns } : {}),
    ...(manualBreaks !== undefined ? { manualBreaks } : {}),
  };
}

// --- repeatColumns/repeatRows structural wrapping --------------------------------------------

// Dissolves any existing wrapperTag element back into tableElement's own direct children at the wrapper's own position -- called unconditionally before applying a fresh repeatRows/repeatColumns so a second writeSheetPrintSettings call on the same sheet never leaves a stale wrapper from an earlier call sitting alongside (or nested inside) a new one.
function unwrapHeaderGroup(tableElement: XmlElement, wrapperTag: string): void {
  const index = tableElement.children.findIndex(
    (child) => child.type === "element" && child.tag === wrapperTag,
  );
  if (index === -1) {
    return;
  }
  const wrapper = tableElement.children[index];
  if (wrapper?.type !== "element") {
    return;
  }
  tableElement.children.splice(index, 1, ...wrapper.children);
}

interface RangeElement {
  readonly position: number;
  readonly element: XmlElement;
}

// Every `tag` member (with its own array position within `children`) whose full repeat-run lies entirely within [start, end] -- used only after replaceRun has already individuated both boundaries, so a run genuinely spanning the range never gets split mid-wrap.
function collectRangeElements(
  children: XmlNode[],
  tag: string,
  repeatAttr: string,
  start: number,
  end: number,
): RangeElement[] {
  let cursor = 0;
  const found: RangeElement[] = [];
  children.forEach((node, position) => {
    if (node.type !== "element" || node.tag !== tag) {
      return;
    }
    const count = readRunRepeatCount(node, repeatAttr);
    if (cursor >= start && cursor + count - 1 <= end) {
      found.push({ position, element: node });
    }
    cursor += count;
  });
  return found;
}

// Moves the real table:table-column/table:table-row elements covering [range.start, range.end] into a fresh table:table-header-columns/table:table-header-rows wrapper -- the structural transform odf.js's own readTable recognises as repeatColumns/repeatRows on the way back in. Individuates both boundaries first (replaceRun, exactly as every other column/row write in this editor does) so the range's own element runs align precisely with the requested indices before anything is moved. Stamps a real default width/height on every range element that lacks one before the move, so a repeatColumns/repeatRows range set beyond any cell a caller has touched does not produce the "explicit but unstyled" zero-width/height columns/rows (src/edit/ods/column-row.ts's own top-of-file note) the cell()-materialisation fix already closed for cell()/mergeCells()/setColumnHidden()/setRowHidden() -- the same hazard, reachable through print settings instead. Callers are responsible for having already dissolved any stale prior wrapper of the same tag (writeSheetPrintSettings's own unconditional unwrapHeaderGroup call, below) -- this function only ever builds a fresh one, never merges into an existing one.
function wrapRepeatRange(
  tableElement: XmlElement,
  memberTag: string,
  repeatAttr: string,
  wrapperTag: string,
  range: ContentSheetRepeatRange,
  buildEmpty: () => XmlElement,
  pkg: Package,
): void {
  replaceRun(
    tableElement.children,
    isElementWithTag(memberTag),
    range.start,
    repeatAttr,
    buildEmpty,
  );
  replaceRun(
    tableElement.children,
    isElementWithTag(memberTag),
    range.end,
    repeatAttr,
    buildEmpty,
  );
  // Stamp a real default width/height on EVERY member element from position 0 through range.end, not only the in-range ones the move collects below -- replaceRun's gap-fill (case 3, address.ts) appends a bare, unstyled run for any positions between the table's prior coverage and range.start, and those exterior gap-fills lie OUTSIDE [range.start, range.end] so the move's own collectRangeElements never reaches them. ensureColumnElementDefaultWidth/ensureRowElementDefaultHeight no-op on an element that already carries a width/height (a real source column/row, or one cell() already individuated), so scanning the whole [0, range.end] span stamps only the genuinely unstyled gap-fills -- the in-range ones AND the exterior ones alike.
  for (const entry of collectRangeElements(
    tableElement.children,
    memberTag,
    repeatAttr,
    0,
    range.end,
  )) {
    if (memberTag === COLUMN_TAG) {
      ensureColumnElementDefaultWidth(pkg, entry.element);
    } else {
      ensureRowElementDefaultHeight(pkg, entry.element);
    }
  }
  const found = collectRangeElements(
    tableElement.children,
    memberTag,
    repeatAttr,
    range.start,
    range.end,
  );
  if (found.length === 0) {
    return;
  }
  const firstPosition = found[0]!.position;
  const elements = found.map((entry) => entry.element);
  const positions = found.map((entry) => entry.position);
  for (let i = positions.length - 1; i >= 0; i--) {
    tableElement.children.splice(positions[i]!, 1);
  }
  tableElement.children.splice(firstPosition, 0, el(wrapperTag, {}, elements));
}

// Mints a fresh, uniquely-named style:page-layout (styles.xml/office:automatic-styles) carrying pageSize/margins/gridlines/headers/pageOrder/scalePercent/fitToPages, a fresh style:master-page (styles.xml/office:master-styles) referencing it, and a fresh style:style[family="table"] (content.xml/office:automatic-styles) referencing THAT -- then repoints tableElement's own table:style-name to the new table-style, writes table:print-ranges directly on tableElement for printRange, structurally wraps repeatColumns/repeatRows (wrapRepeatRange above, dissolving any stale wrapper from an earlier call first), and applies manualBreaks to each named row/column's own style (writeRowManualBreak/writeColumnManualBreak, column-row.ts -- these preserve any width/height a prior writeColumnWidth/writeRowHeight call already set on that same index, see that file's own top-of-file note). Always mints fresh page-layout/master-page/table-style names rather than searching for a reusable match: the same append-only "a setter always mints a fresh style:style and repoints, never mutates an existing entry" convention src/edit/odg/style.ts's own top-of-file note already documents and every other StyleRegistry-backed setter in this package shares -- a later call for a DIFFERENT sheet with different settings can never accidentally perturb an earlier sheet's own already-written style chain.
//
// manualBreaks is the one field this function does not make fully idempotent across repeated calls on the SAME sheet: each call only ADDS the breaks named in `settings.manualBreaks` (if any), rather than first clearing every break a PRIOR call may have set on some other row/column -- doing that fully would mean scanning and clearing fo:break-before off every row/column this sheet has ever touched, not just the ones named this time. A documented, bounded gap, not a silent one: buildOdsPackage (content.ts) only ever calls this once per sheet, so the common case is unaffected; a caller setting printSettings twice with different manualBreaks each time ends up with the union of both calls' breaks.
export function writeSheetPrintSettings(
  pkg: Package,
  tableElement: XmlElement,
  settings: ContentSheetPrintSettings,
): void {
  const stylesAutomaticStyles = findStylesAutomaticStyles(pkg);
  const masterStyles = findMasterStyles(pkg);
  const contentAutomaticStyles = findContentAutomaticStyles(pkg);

  const printTokens = [
    settings.gridlines ? "grid" : undefined,
    settings.headers ? "headers" : undefined,
  ].filter((token): token is string => token !== undefined);

  const pageLayoutName = nextStyleName(
    stylesAutomaticStyles,
    "style:page-layout",
    "OdsPageLayout",
  );
  stylesAutomaticStyles.children.push(
    el("style:page-layout", { "style:name": pageLayoutName }, [
      el("style:page-layout-properties", {
        "fo:page-width": formatOdfLength(settings.pageSize.widthPt),
        "fo:page-height": formatOdfLength(settings.pageSize.heightPt),
        "fo:margin-top": formatOdfLength(settings.margins.topPt),
        "fo:margin-right": formatOdfLength(settings.margins.rightPt),
        "fo:margin-bottom": formatOdfLength(settings.margins.bottomPt),
        "fo:margin-left": formatOdfLength(settings.margins.leftPt),
        ...(printTokens.length > 0
          ? { "style:print": printTokens.join(" ") }
          : {}),
        "style:print-page-order":
          settings.pageOrder === "overThenDown" ? "ltr" : "ttb",
        ...(settings.scalePercent !== undefined
          ? { "style:scale-to": `${settings.scalePercent}%` }
          : {}),
        ...(settings.fitToPages !== undefined
          ? {
              "style:scale-to-X": String(settings.fitToPages.width),
              "style:scale-to-Y": String(settings.fitToPages.height),
            }
          : {}),
      }),
    ]),
  );

  const masterPageName = nextStyleName(
    masterStyles,
    "style:master-page",
    "OdsMasterPage",
  );
  masterStyles.children.push(
    el("style:master-page", {
      "style:name": masterPageName,
      "style:page-layout-name": pageLayoutName,
    }),
  );

  const tableStyleName = nextStyleName(
    contentAutomaticStyles,
    "style:style",
    "OdsSheetPrint",
  );
  contentAutomaticStyles.children.push(
    el("style:style", {
      "style:name": tableStyleName,
      "style:family": "table",
      "style:master-page-name": masterPageName,
    }),
  );

  setAttr(tableElement, "table:style-name", tableStyleName);

  if (settings.printRange !== undefined) {
    const sheetName = attr(tableElement, "table:name");
    if (sheetName === undefined) {
      throw new Error(
        "writeSheetPrintSettings: printRange requires tableElement to already carry a table:name",
      );
    }
    setAttr(
      tableElement,
      "table:print-ranges",
      formatPrintRange(sheetName, settings.printRange),
    );
  }

  unwrapHeaderGroup(tableElement, HEADER_COLUMNS_TAG);
  if (settings.repeatColumns !== undefined) {
    wrapRepeatRange(
      tableElement,
      COLUMN_TAG,
      COLUMN_REPEAT_ATTR,
      HEADER_COLUMNS_TAG,
      settings.repeatColumns,
      () => el(COLUMN_TAG),
      pkg,
    );
  }

  unwrapHeaderGroup(tableElement, HEADER_ROWS_TAG);
  if (settings.repeatRows !== undefined) {
    wrapRepeatRange(
      tableElement,
      ROW_TAG,
      ROW_REPEAT_ATTR,
      HEADER_ROWS_TAG,
      settings.repeatRows,
      () => el(ROW_TAG),
      pkg,
    );
  }

  if (settings.manualBreaks !== undefined) {
    for (const columnIndex of settings.manualBreaks.columns) {
      writeColumnManualBreak(pkg, tableElement, columnIndex);
    }
    for (const rowIndex of settings.manualBreaks.rows) {
      writeRowManualBreak(pkg, tableElement, rowIndex);
    }
  }
}
