import type {
  ContentCellBorders,
  ContentStrokeStyle,
  Color,
} from "document-schema.js";
import type { XmlElement, XmlNode } from "ooxml.js";
import { attr, readCellShading } from "ooxml.js";
import {
  colorToRgbHex,
  resolveCellFillColor,
  rgbHexToColor,
} from "document-schema.js";
import { ptToTwips, twipsToPt } from "../../model/units";
import {
  directChildElement,
  insertInSchemaOrder,
  removeChild,
} from "../../xml/edit";
import { el } from "../../xml/fragment";
import type { PlacedLiveCell, TableGridRows } from "../table-grid";
import { resolveLiveTableGrid } from "../table-grid";
import type { ParagraphInit } from "./paragraph";
import { buildParagraph, DocxParagraph } from "./paragraph";

export interface TableInit {
  readonly rows: number;
  readonly columns: number;
  readonly columnWidthsTwips?: readonly number[];
}

// 12240 (US Letter page width, twips) - 2 x 1440 (1in margins), matching createEmptyDocxPackage's default section — the content width a new table defaults to when no explicit widths are given.
const DEFAULT_TABLE_WIDTH_TWIPS = 9360;

// ECMA-376 CT_TcPrBase's own child element sequence, narrowed to the elements this codebase writes — w:gridSpan before w:vMerge before w:tcBorders before w:shd when several are present on one cell.
const TC_PR_CHILD_ORDER = ["w:gridSpan", "w:vMerge", "w:tcBorders", "w:shd"];

// ECMA-376 CT_TcBorders' own child sequence is top, start/left, bottom, end/right — narrowed to the four edges this editor reads and writes (the reader at ooxml.js read.js falls back from w:start/w:end to w:left/w:right, so writing left/right is the form both Word and that reader accept).
const TC_BORDERS_CHILD_ORDER = ["w:top", "w:left", "w:bottom", "w:right"];

// w:tcBorders/@w:sz is in eighth-points-of-a-point (1pt = 8 eighth-points), the unit ECMA-376 CT_Border uses for cell and paragraph borders — distinct from both w:sz the run-size half-point and the twips w:ind/w:spacing use.
const EIGHTH_POINTS_PER_POINT = 8;

const DOCX_BORDER_STYLE_TO_VAL: Readonly<Record<ContentStrokeStyle, string>> = {
  solid: "single",
  dashed: "dashed",
  dotted: "dotted",
  double: "double",
};

// The reverse of ooxml.js read.js's BORDER_STYLE_MAP for the four vals this editor writes; any other val reads back as 'solid' (the same default read.js applies to unrecognised vals).
function valToBorderStyle(val: string): ContentStrokeStyle {
  if (val === "dashed") {
    return "dashed";
  }
  if (val === "dotted") {
    return "dotted";
  }
  if (val === "double") {
    return "double";
  }
  return "solid";
}

export type DocxVerticalMerge = "restart" | "continue";

export class DocxTableCell {
  constructor(private readonly node: XmlElement) {}

  // w:tcPr must be the FIRST child of w:tc, before any w:p/w:tbl block content (ECMA-376 CT_Tc) — unlike TC_PR_CHILD_ORDER's own internal ordering, this is a plain unshift since w:tcPr has no ordered sibling of its own kind to insert relative to.
  private tcPrElement(create: true): XmlElement;
  private tcPrElement(create: false): XmlElement | undefined;
  private tcPrElement(create: boolean): XmlElement | undefined {
    const existing = directChildElement(this.node, "w:tcPr");
    if (existing !== undefined || !create) {
      return existing;
    }
    const created = el("w:tcPr");
    this.node.children.unshift(created);
    return created;
  }

  get colSpan(): number | undefined {
    const tcPr = this.tcPrElement(false);
    const gridSpan =
      tcPr === undefined ? undefined : directChildElement(tcPr, "w:gridSpan");
    const val = gridSpan === undefined ? undefined : attr(gridSpan, "w:val");
    return val === undefined ? undefined : Number(val);
  }

  // Merges N grid columns into this one cell (ECMA-376 w:tcPr/w:gridSpan) — the write-side inverse of ooxml.js's own readTable, whose ContentTableCell.colSpan this mirrors. A caller building a merged table writes this on the SPAN'S OWN starting cell only; there is no separate DOM element for the columns it covers, since docx (unlike ODF) simply omits a w:tc for each consumed column rather than writing an explicit placeholder for it.
  set colSpan(value: number | undefined) {
    if (value === undefined) {
      const tcPr = this.tcPrElement(false);
      if (tcPr !== undefined) {
        tcPr.children = tcPr.children.filter(
          (c) => !(c.type === "element" && c.tag === "w:gridSpan"),
        );
      }
      return;
    }
    const tcPr = this.tcPrElement(true);
    tcPr.children = tcPr.children.filter(
      (c) => !(c.type === "element" && c.tag === "w:gridSpan"),
    );
    insertInSchemaOrder(
      tcPr,
      el("w:gridSpan", { "w:val": String(value) }),
      TC_PR_CHILD_ORDER,
    );
  }

  // Replaces every block-level child of the w:tc with one empty paragraph, keeping w:tcPr. ECMA-376 CT_Tc is `tcPr?` followed by one or more block-level elements, so an empty w:p is the minimal valid body. The children array is edited in place so views holding it (DocxParagraph's container) never see a detached copy.
  private clearBlockContent(): void {
    const properties = this.node.children.filter(
      (child) => child.type === "element" && child.tag === "w:tcPr",
    );
    this.node.children.splice(
      0,
      this.node.children.length,
      ...properties,
      buildParagraph(),
    );
  }

  get verticalMerge(): DocxVerticalMerge | undefined {
    const tcPr = this.tcPrElement(false);
    const vMerge =
      tcPr === undefined ? undefined : directChildElement(tcPr, "w:vMerge");
    if (vMerge === undefined) {
      return undefined;
    }
    return attr(vMerge, "w:val") === "restart" ? "restart" : "continue";
  }

  // Marks this cell as the start ('restart') or a covered continuation ('continue') of a vertical merge (ECMA-376 w:tcPr/w:vMerge) — unlike colSpan, a vertically-merged region DOES need one real w:tc per covered row (Word's own reader has nowhere else to hang that row's own row-height/content), so a caller building a merged table writes 'restart' on the top cell and 'continue' on the corresponding cell in every row it covers. A continuation cell holds no content of its own, because the merged region's content belongs to the cell that restarts it and readDocxContent drops whatever a continuation cell carries: text left in one would stay in the part while being invisible to every view built from it. Setting 'continue' therefore discards the cell's block content, leaving the single empty w:p that ECMA-376 CT_Tc requires of every w:tc.
  set verticalMerge(value: DocxVerticalMerge | undefined) {
    if (value === "continue") {
      this.clearBlockContent();
    }
    if (value === undefined) {
      const tcPr = this.tcPrElement(false);
      if (tcPr !== undefined) {
        tcPr.children = tcPr.children.filter(
          (c) => !(c.type === "element" && c.tag === "w:vMerge"),
        );
      }
      return;
    }
    const tcPr = this.tcPrElement(true);
    tcPr.children = tcPr.children.filter(
      (c) => !(c.type === "element" && c.tag === "w:vMerge"),
    );
    insertInSchemaOrder(
      tcPr,
      value === "restart"
        ? el("w:vMerge", { "w:val": "restart" })
        : el("w:vMerge"),
      TC_PR_CHILD_ORDER,
    );
  }

  // Cell background fill (ECMA-376 w:tcPr/w:shd), read through ooxml.js's own readCellShading — the same w:val-based resolution readDocxContent applies to every table cell (w:val="clear" from w:fill, w:val="solid" from w:color instead, every other named pattern token from whichever of w:color/w:fill states a concrete colour) — reduced to a single representative Color via resolveCellFillColor, since this editor's own live model carries one flat colour rather than the full ContentCellFill shape (see the write side's identical reduction in edit/docx/content.ts). Reading w:fill directly, as this getter once did, silently returned the wrong colour for a w:val="solid" cell (whose real colour lives in w:color) and no colour at all for a genuine pattern fill; delegating to readCellShading keeps this getter from re-deriving its own, easily-diverging copy of that resolution.
  get background(): Color | undefined {
    const tcPr = this.tcPrElement(false);
    const fill = readCellShading(tcPr);
    return fill === undefined ? undefined : resolveCellFillColor(fill);
  }

  set background(value: Color | undefined) {
    if (value === undefined) {
      const tcPr = this.tcPrElement(false);
      if (tcPr !== undefined) {
        tcPr.children = tcPr.children.filter(
          (c) => !(c.type === "element" && c.tag === "w:shd"),
        );
      }
      return;
    }
    const tcPr = this.tcPrElement(true);
    tcPr.children = tcPr.children.filter(
      (c) => !(c.type === "element" && c.tag === "w:shd"),
    );
    insertInSchemaOrder(
      tcPr,
      el("w:shd", {
        "w:val": "clear",
        "w:color": "auto",
        "w:fill": colorToRgbHex(value),
      }),
      TC_PR_CHILD_ORDER,
    );
  }

  // Per-edge cell borders (ECMA-376 w:tcPr/w:tcBorders) — each present edge is a w:top/w:left/w:bottom/w:right child carrying w:val (single/dashed/dotted/double), w:sz (eighth-points), w:color (RRGGBB). The write-side inverse of readCellBorders, whose ContentTableCell.borders this mirrors; the bridge bypasses PDF, so the border STYLE (solid/dashed/dotted/double) is carried too — valid here even though PDF-pivot conversions render every border solid.
  get borders(): ContentCellBorders | undefined {
    const tcPr = this.tcPrElement(false);
    const tcBorders =
      tcPr === undefined ? undefined : directChildElement(tcPr, "w:tcBorders");
    if (tcBorders === undefined) {
      return undefined;
    }
    const borders: ContentCellBorders = {};
    for (const edge of ["top", "left", "bottom", "right"] as const) {
      const element = directChildElement(tcBorders, `w:${edge}`);
      const val = element === undefined ? undefined : attr(element, "w:val");
      if (
        element === undefined ||
        val === undefined ||
        val === "nil" ||
        val === "none"
      ) {
        continue;
      }
      const sz = attr(element, "w:sz");
      const colorVal = attr(element, "w:color");
      const color: Color =
        colorVal === undefined || colorVal === "auto"
          ? { r: 0, g: 0, b: 0 }
          : rgbHexToColor(colorVal);
      borders[edge] = {
        color,
        widthPt:
          Number(sz ?? String(EIGHTH_POINTS_PER_POINT)) /
          EIGHTH_POINTS_PER_POINT,
        style: valToBorderStyle(val),
      };
    }
    return Object.keys(borders).length === 0 ? undefined : borders;
  }

  set borders(value: ContentCellBorders | undefined) {
    if (value === undefined) {
      const tcPr = this.tcPrElement(false);
      if (tcPr !== undefined) {
        tcPr.children = tcPr.children.filter(
          (c) => !(c.type === "element" && c.tag === "w:tcBorders"),
        );
      }
      return;
    }
    const tcPr = this.tcPrElement(true);
    tcPr.children = tcPr.children.filter(
      (c) => !(c.type === "element" && c.tag === "w:tcBorders"),
    );
    const tcBorders = el("w:tcBorders");
    for (const edge of TC_BORDERS_CHILD_ORDER) {
      const border =
        value[
          edge === "w:top"
            ? "top"
            : edge === "w:left"
              ? "left"
              : edge === "w:bottom"
                ? "bottom"
                : "right"
        ];
      if (border === undefined) {
        continue;
      }
      tcBorders.children.push(
        el(edge, {
          "w:val": DOCX_BORDER_STYLE_TO_VAL[border.style ?? "solid"],
          "w:sz": String(Math.round(border.widthPt * EIGHTH_POINTS_PER_POINT)),
          "w:color": colorToRgbHex(border.color),
        }),
      );
    }
    insertInSchemaOrder(tcPr, tcBorders, TC_PR_CHILD_ORDER);
  }

  paragraphs(): DocxParagraph[] {
    const out: DocxParagraph[] = [];
    for (const child of this.node.children) {
      if (child.type === "element" && child.tag === "w:p") {
        out.push(new DocxParagraph(this.node.children, child));
      }
    }
    return out;
  }

  appendParagraph(init?: ParagraphInit): DocxParagraph {
    const paragraphElement = buildParagraph(init);
    this.node.children.push(paragraphElement);
    return new DocxParagraph(this.node.children, paragraphElement);
  }

  get text(): string {
    return this.paragraphs()
      .map((p) => p.text)
      .join("\n");
  }
}

export class DocxTableRow {
  constructor(private readonly node: XmlElement) {}

  // w:trPr must be the FIRST child of w:tr (ECMA-376 CT_Row: trPr?, tblPrEx?, tc+), ahead of every w:tc — a fixed-prefix invariant this row-property helper enforces by unshift, the same approach DocxTableCell.tcPrElement uses for w:tcPr inside w:tc.
  private trPrElement(create: boolean): XmlElement | undefined {
    const existing = directChildElement(this.node, "w:trPr");
    if (existing !== undefined || !create) {
      return existing;
    }
    const created = el("w:trPr");
    this.node.children.unshift(created);
    return created;
  }

  // The row's PHYSICAL cells: one view per w:tc element. A horizontally merged region is one w:tc carrying w:gridSpan, so after a merge this holds fewer cells than the table has grid columns and an index into it is not a grid column. DocxTable.gridRows is the grid-addressed view; DocxTableRow.mergeCellsHorizontally takes a grid column, not an index into this list.
  cells(): DocxTableCell[] {
    const out: DocxTableCell[] = [];
    for (const child of this.node.children) {
      if (child.type === "element" && child.tag === "w:tc") {
        out.push(new DocxTableCell(child));
      }
    }
    return out;
  }

  // Row height (ECMA-376 w:trPr/w:trHeight, value in twentieths-of-a-point). w:hRule="atLeast" preserves the source's intent — a minimum row height that grows to fit taller content — without clipping it the way "exact" would; odf.js's own reader resolves an ODF row height the same way (style:row-height is the value, content can still grow the row). This is the only row property this editor models because it is the only one ContentTableRow carries. Genuinely bidirectional today: ooxml.js's own readTable populates ContentTableRow.heightPt from w:trHeight and its writer emits w:trHeight back, so both the odt -> docx and docx -> odt bridges carry a row height through — the latter via OdtTableRow's own heightPt getter/setter (src/edit/odt/table.ts), the ODF-side mirror of this one.
  get heightPt(): number | undefined {
    const trPr = this.trPrElement(false);
    const trHeight =
      trPr === undefined ? undefined : directChildElement(trPr, "w:trHeight");
    const val = trHeight === undefined ? undefined : attr(trHeight, "w:val");
    return val === undefined ? undefined : twipsToPt(Number(val));
  }

  set heightPt(value: number | undefined) {
    const trPr = this.trPrElement(value !== undefined);
    if (trPr === undefined) {
      return;
    }
    trPr.children = trPr.children.filter(
      (c) => !(c.type === "element" && c.tag === "w:trHeight"),
    );
    if (value === undefined) {
      return;
    }
    trPr.children.push(
      el("w:trHeight", {
        "w:val": String(ptToTwips(value)),
        "w:hRule": "atLeast",
      }),
    );
  }

  // Whether this row is a header row (ECMA-376 17.4.78 w:trPr/w:tblHeader): the row repeats at the top of each page the table continues onto. An on/off property, so a present element with no w:val is on and an explicit w:val of 0, false or off is off, which is what ooxml.js's own reader reads back into ContentTableRow.isHeader.
  get isHeader(): boolean {
    const trPr = this.trPrElement(false);
    const tblHeader =
      trPr === undefined ? undefined : directChildElement(trPr, "w:tblHeader");
    if (tblHeader === undefined) {
      return false;
    }
    const val = attr(tblHeader, "w:val");
    return val !== "0" && val !== "false" && val !== "off";
  }

  set isHeader(value: boolean) {
    const trPr = this.trPrElement(value);
    if (trPr === undefined) {
      return;
    }
    trPr.children = trPr.children.filter(
      (c) => !(c.type === "element" && c.tag === "w:tblHeader"),
    );
    if (!value) {
      return;
    }
    trPr.children.push(el("w:tblHeader", {}));
  }

  // Merges colSpan grid columns of THIS row into one cell (ECMA-376 w:tcPr/w:gridSpan on the surviving anchor cell), the horizontal-merge primitive docx lacks as an attribute: unlike vertical merge, which is a pure attribute setter on an existing w:tc (DocxTableCell.verticalMerge above), docx omits a w:tc entirely for a column a merge consumes, so the consumed cells' own w:tc elements are REMOVED from the row. Their content is discarded silently and unconditionally, matching OdsSheet.mergeCells' own established precedent (src/edit/ods/sheet.ts): documented, intentional behaviour, not a silent trap.
  //
  // startColumnIndex is a GRID column: the position a w:tc starts at is the sum of the w:gridSpan of the cells before it, so it is not an index into cells(). The merged region is grid columns startColumnIndex up to startColumnIndex + colSpan, and every w:tc that starts inside it is consumed. The merge is refused, with an error naming the grid column, when it cannot be carried out without leaving the table in a state the grid rule forbids: the start column lies inside a cell that started earlier, the region would cut through a cell reaching past its last column, or a cell it would consume (or widen) takes part in a vertical merge. The last case is a refusal rather than an extension because a vertical merge is a chain of w:tc elements across rows that must line up in start column and span, so widening one row's cell correctly means rewriting every row of the chain and swallowing whatever those rows hold in the widened columns, which may belong to other vertical merges; that is a rectangle merge, and DocxTable.mergeCells is where it is decided, after the vertical merge has been unmerged. A merge that would change nothing is never refused.
  mergeCellsHorizontally(
    startColumnIndex: number,
    colSpan: number,
  ): DocxTableCell {
    if (!Number.isInteger(colSpan) || colSpan < 1) {
      throw new Error(
        `mergeCellsHorizontally: colSpan must be a positive integer, got ${colSpan}`,
      );
    }
    const plan = planHorizontalMerge(
      this.node,
      startColumnIndex,
      colSpan,
      false,
    );
    if ("refusal" in plan) {
      throw new Error(`mergeCellsHorizontally: ${plan.refusal}`);
    }
    return applyHorizontalMerge(plan, colSpan);
  }
}

// A w:tc together with the grid columns it occupies: the columns from startColumn up to startColumn + span.
interface RowCell {
  readonly element: XmlElement;
  readonly startColumn: number;
  readonly span: number;
  readonly takesPartInVerticalMerge: boolean;
}

function rowCells(row: XmlElement): RowCell[] {
  const out: RowCell[] = [];
  let column = 0;
  for (const child of row.children) {
    if (child.type === "element" && child.tag === "w:tc") {
      const cell = new DocxTableCell(child);
      const span = cell.colSpan ?? 1;
      out.push({
        element: child,
        startColumn: column,
        span,
        takesPartInVerticalMerge: cell.verticalMerge !== undefined,
      });
      column += span;
    }
  }
  return out;
}

// A merge the row allows: the w:tc that survives as the merged cell and the w:tc elements the merge removes.
interface HorizontalMergeAllowed {
  readonly row: XmlElement;
  readonly anchor: XmlElement;
  readonly consumed: readonly XmlElement[];
  readonly refusal?: never;
}

// A merge the row refuses, and why, phrased to follow the name of the operation that refused it.
interface HorizontalMergeRefused {
  readonly refusal: string;
  readonly row?: never;
  readonly anchor?: never;
  readonly consumed?: never;
}

type HorizontalMergePlan = HorizontalMergeAllowed | HorizontalMergeRefused;

function refuse(refusal: string): HorizontalMergeRefused {
  return { refusal };
}

// Decides a horizontal merge without changing anything, so a caller merging several rows can find out that a later row refuses before any earlier row has changed. `joinsVerticalMerge` says the caller is about to attach a vertical merge to the anchor: the region must then be free of vertical merges outright, whereas otherwise a cell that takes part in one is only a problem when the merge would consume another cell beside it.
function planHorizontalMerge(
  row: XmlElement,
  startColumn: number,
  colSpan: number,
  joinsVerticalMerge: boolean,
): HorizontalMergePlan {
  const cells = rowCells(row);
  const last = cells[cells.length - 1];
  const width = last === undefined ? 0 : last.startColumn + last.span;
  const anchor = cells.find(
    (cell) =>
      cell.startColumn <= startColumn &&
      startColumn < cell.startColumn + cell.span,
  );
  if (anchor === undefined) {
    return refuse(`column ${startColumn} does not exist in this row`);
  }
  if (anchor.startColumn !== startColumn) {
    return refuse(
      `column ${startColumn} is covered by the cell starting at column ${anchor.startColumn}`,
    );
  }
  const endColumn = startColumn + colSpan;
  if (endColumn > width) {
    return refuse(
      `colSpan ${colSpan} starting at column ${startColumn} exceeds this row's own ${width} grid columns`,
    );
  }
  const region = cells.filter(
    (cell) => cell.startColumn >= startColumn && cell.startColumn < endColumn,
  );
  const straddling = region.find(
    (cell) => cell.startColumn + cell.span > endColumn,
  );
  if (straddling !== undefined) {
    return refuse(
      `the cell at column ${straddling.startColumn} spans columns ${straddling.startColumn} to ${straddling.startColumn + straddling.span - 1}, past the last merged column ${endColumn - 1}`,
    );
  }
  const consumed = region.filter((cell) => cell !== anchor);
  const verticallyMerged =
    joinsVerticalMerge || consumed.length > 0
      ? region.find((cell) => cell.takesPartInVerticalMerge)
      : undefined;
  if (verticallyMerged !== undefined) {
    return refuse(
      `column ${verticallyMerged.startColumn} takes part in a vertical merge and cannot be merged over`,
    );
  }
  return {
    row,
    anchor: anchor.element,
    consumed: consumed.map((cell) => cell.element),
  };
}

function applyHorizontalMerge(
  plan: HorizontalMergeAllowed,
  colSpan: number,
): DocxTableCell {
  for (const consumed of plan.consumed) {
    removeChild(plan.row.children, consumed);
  }
  const anchor = new DocxTableCell(plan.anchor);
  anchor.colSpan = colSpan;
  return anchor;
}

// One w:tc with the grid column it starts at and whether it continues the vertical merge above it.
interface PhysicalCell {
  readonly cell: DocxTableCell;
  readonly columnIndex: number;
  readonly continuesVerticalMerge: boolean;
}

function physicalCells(cells: readonly DocxTableCell[]): PhysicalCell[] {
  let column = 0;
  return cells.map((cell) => {
    const columnIndex = column;
    column += cell.colSpan ?? 1;
    return {
      cell,
      columnIndex,
      continuesVerticalMerge: cell.verticalMerge === "continue",
    };
  });
}

// The number of rows a cell starting at columnIndex covers, counting the cell's own: the run of rows directly below it whose cell at the same start column continues a vertical merge. ECMA-376 stores no row count, only a continuation marker per row, so the span is derived the way ooxml.js's own reader derives it.
function verticalSpan(
  rowsBelow: readonly (readonly PhysicalCell[])[],
  columnIndex: number,
): number {
  let span = 1;
  for (const row of rowsBelow) {
    const below = row.find((cell) => cell.columnIndex === columnIndex);
    if (!below?.continuesVerticalMerge) {
      break;
    }
    span++;
  }
  return span;
}

function placeCells(
  rows: readonly (readonly DocxTableCell[])[],
): PlacedLiveCell<DocxTableCell>[][] {
  const physical = rows.map(physicalCells);
  return physical.map((row, rowIndex) =>
    row.map(({ cell, columnIndex, continuesVerticalMerge }) => ({
      cell,
      columnIndex,
      colSpan: continuesVerticalMerge ? undefined : cell.colSpan,
      rowSpan: continuesVerticalMerge
        ? undefined
        : verticalSpan(physical.slice(rowIndex + 1), columnIndex),
    })),
  );
}

function buildCell(): XmlElement {
  return el("w:tc", {}, [buildParagraph()]);
}

// The number of w:gridCol the table's own w:tblGrid declares.
function declaredGridColumnCount(table: XmlElement): number {
  const tblGrid = directChildElement(table, "w:tblGrid");
  return tblGrid === undefined
    ? 0
    : tblGrid.children.filter(
        (child) => child.type === "element" && child.tag === "w:gridCol",
      ).length;
}

export class DocxTable {
  private readonly container: XmlNode[];
  private readonly node: XmlElement;
  private removed = false;

  constructor(container: XmlNode[], node: XmlElement) {
    this.container = container;
    this.node = node;
  }

  private live(): XmlElement {
    if (this.removed) {
      throw new Error(
        "this DocxTable has been removed and can no longer be used",
      );
    }
    return this.node;
  }

  private rowElements(): XmlElement[] {
    const out: XmlElement[] = [];
    for (const child of this.live().children) {
      if (child.type === "element" && child.tag === "w:tr") {
        out.push(child);
      }
    }
    return out;
  }

  rows(): DocxTableRow[] {
    return this.rowElements().map((row) => new DocxTableRow(row));
  }

  // The grid's own view of the table, resolved from the cells' w:gridSpan and w:vMerge the way the content pivot resolves it: gridRows()[r][c] is the position at grid row r and grid column c, and every row is gridColumnCount() wide however many w:tc elements it physically holds. A position a merged region covers resolves to the region's anchor cell, with isAnchor false; that is the cell to read or edit for any position inside the region. An entry is undefined only where a row has no w:tc for a position and no merge covers it. Unlike rows()[r].cells(), whose index is a physical position, the column here is the same grid column DocxTableRow.mergeCellsHorizontally and DocxTable.mergeCells take.
  gridRows(): TableGridRows<DocxTableCell> {
    return this.grid().rows;
  }

  // The table's width in grid columns: the larger of the w:tblGrid's own w:gridCol count and the widest row's sum of w:gridSpan, which is what a horizontal merge leaves unchanged and what rows()[r].cells().length under-reports once a row holds a merge.
  gridColumnCount(): number {
    return this.grid().columnCount;
  }

  private grid() {
    const table = this.live();
    return resolveLiveTableGrid(
      placeCells(this.rows().map((row) => row.cells())),
      declaredGridColumnCount(table),
    );
  }

  // The PHYSICAL cell at columnIndex of row rowIndex: an index into DocxTableRow.cells(), not a grid column, so once a row holds a horizontal merge it is not the cell at that grid column. gridRows() is the grid-addressed lookup.
  cell(rowIndex: number, columnIndex: number): DocxTableCell {
    const row = this.rows()[rowIndex];
    if (row === undefined) {
      throw new Error(`row ${rowIndex} does not exist in this table`);
    }
    const cell = row.cells()[columnIndex];
    if (cell === undefined) {
      throw new Error(
        `column ${columnIndex} does not exist in row ${rowIndex}`,
      );
    }
    return cell;
  }

  appendRow(columnCount: number): DocxTableRow {
    const node = this.live();
    const cells: XmlElement[] = [];
    for (let i = 0; i < columnCount; i++) {
      cells.push(buildCell());
    }
    const row = el("w:tr", {}, cells);
    node.children.push(row);
    return new DocxTableRow(row);
  }

  // Merges the rowSpan x colSpan rectangle anchored at (startRow, startColumn), both columns being grid columns: DocxTableRow.mergeCellsHorizontally on every covered row, then a w:vMerge restart on the anchor and a continuation on the cell each covered row keeps, so a covered row carries the same w:gridSpan as the anchor. Docx's own per-row gridSpan means every covered row, not just the anchor row, needs its own horizontal merge before its cell can continue the vertical one.
  //
  // Every row is checked before any row changes, so a refusal leaves the table exactly as it was. A rectangle is refused, naming the row and the grid column, wherever DocxTableRow.mergeCellsHorizontally would refuse, and also when it covers a cell that already takes part in a vertical merge, since attaching a second vertical merge to that cell would leave the first without the rows it spans.
  mergeCells(
    startRow: number,
    startColumn: number,
    rowSpan: number,
    colSpan: number,
  ): DocxTableCell {
    if (
      !Number.isInteger(rowSpan) ||
      rowSpan < 1 ||
      !Number.isInteger(colSpan) ||
      colSpan < 1
    ) {
      throw new Error(
        `mergeCells: rowSpan and colSpan must be positive integers, got rowSpan=${rowSpan}, colSpan=${colSpan}`,
      );
    }
    const rows = this.rowElements();
    const anchorRow = rows[startRow];
    if (anchorRow === undefined) {
      throw new Error(
        `mergeCells: row ${startRow} does not exist in this table`,
      );
    }
    if (startRow + rowSpan > rows.length) {
      throw new Error(
        `mergeCells: rowSpan ${rowSpan} starting at row ${startRow} exceeds this table's own ${rows.length} rows`,
      );
    }
    const planRow = (row: XmlElement, rowIndex: number) => {
      const plan = planHorizontalMerge(row, startColumn, colSpan, rowSpan > 1);
      if ("refusal" in plan) {
        throw new Error(`mergeCells: row ${rowIndex}: ${plan.refusal}`);
      }
      return plan;
    };
    const anchorPlan = planRow(anchorRow, startRow);
    const coveredPlans = rows
      .slice(startRow + 1, startRow + rowSpan)
      .map((row, offset) => planRow(row, startRow + 1 + offset));
    const anchor = applyHorizontalMerge(anchorPlan, colSpan);
    const coveredCells = coveredPlans.map((plan) =>
      applyHorizontalMerge(plan, colSpan),
    );
    if (rowSpan > 1) {
      anchor.verticalMerge = "restart";
      for (const covered of coveredCells) {
        covered.verticalMerge = "continue";
      }
    }
    return anchor;
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}

function buildTblGrid(
  columns: number,
  columnWidthsTwips?: readonly number[],
): XmlElement {
  const defaultWidth = Math.floor(DEFAULT_TABLE_WIDTH_TWIPS / columns);
  const cols: XmlElement[] = [];
  for (let i = 0; i < columns; i++) {
    const width = columnWidthsTwips?.[i] ?? defaultWidth;
    cols.push(el("w:gridCol", { "w:w": String(width) }));
  }
  return el("w:tblGrid", {}, cols);
}

export function buildTable(init: TableInit): XmlElement {
  const rows: XmlElement[] = [];
  for (let r = 0; r < init.rows; r++) {
    const cells: XmlElement[] = [];
    for (let c = 0; c < init.columns; c++) {
      cells.push(buildCell());
    }
    rows.push(el("w:tr", {}, cells));
  }
  return el("w:tbl", {}, [
    buildTblGrid(init.columns, init.columnWidthsTwips),
    ...rows,
  ]);
}
