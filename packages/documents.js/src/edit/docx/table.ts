import type {
  ContentCellBorders,
  ContentStrokeStyle,
  Color,
} from "document-schema.js";
import type { XmlElement, XmlNode } from "ooxml.js";
import { attr } from "ooxml.js";
import { colorToRgbHex, rgbHexToColor } from "document-schema.js";
import { ptToTwips, twipsToPt } from "../../model/units";
import {
  directChildElement,
  insertInSchemaOrder,
  removeChild,
} from "../../xml/edit";
import { el } from "../../xml/fragment";
import type { ParagraphInit } from "./paragraph";
import { buildParagraph, DocxParagraph } from "./paragraph";

export interface TableInit {
  readonly rows: number;
  readonly columns: number;
  readonly columnWidthsTwips?: readonly number[];
}

// 12240 (US Letter page width, twips) - 2 x 1440 (1in margins), matching createEmptyDocxPackage's default section -- the content width a new table defaults to when no explicit widths are given.
const DEFAULT_TABLE_WIDTH_TWIPS = 9360;

// ECMA-376 CT_TcPrBase's own child element sequence, narrowed to the elements this codebase writes -- w:gridSpan before w:vMerge before w:tcBorders before w:shd when several are present on one cell.
const TC_PR_CHILD_ORDER = ["w:gridSpan", "w:vMerge", "w:tcBorders", "w:shd"];

// ECMA-376 CT_TcBorders' own child sequence is top, start/left, bottom, end/right -- narrowed to the four edges this editor reads and writes (the reader at ooxml.js read.js falls back from w:start/w:end to w:left/w:right, so writing left/right is the form both Word and that reader accept).
const TC_BORDERS_CHILD_ORDER = ["w:top", "w:left", "w:bottom", "w:right"];

// w:tcBorders/@w:sz is in eighth-points-of-a-point (1pt = 8 eighth-points), the unit ECMA-376 CT_Border uses for cell and paragraph borders -- distinct from both w:sz the run-size half-point and the twips w:ind/w:spacing use.
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

  // w:tcPr must be the FIRST child of w:tc, before any w:p/w:tbl block content (ECMA-376 CT_Tc) -- unlike TC_PR_CHILD_ORDER's own internal ordering, this is a plain unshift since w:tcPr has no ordered sibling of its own kind to insert relative to.
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

  // Merges N grid columns into this one cell (ECMA-376 w:tcPr/w:gridSpan) -- the write-side inverse of ooxml.js's own readTable, whose ContentTableCell.colSpan this mirrors. A caller building a merged table writes this on the SPAN'S OWN starting cell only; there is no separate DOM element for the columns it covers, since docx (unlike ODF) simply omits a w:tc for each consumed column rather than writing an explicit placeholder for it.
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

  get verticalMerge(): DocxVerticalMerge | undefined {
    const tcPr = this.tcPrElement(false);
    const vMerge =
      tcPr === undefined ? undefined : directChildElement(tcPr, "w:vMerge");
    if (vMerge === undefined) {
      return undefined;
    }
    return attr(vMerge, "w:val") === "restart" ? "restart" : "continue";
  }

  // Marks this cell as the start ('restart') or a covered continuation ('continue') of a vertical merge (ECMA-376 w:tcPr/w:vMerge) -- unlike colSpan, a vertically-merged region DOES need one real w:tc per covered row (Word's own reader has nowhere else to hang that row's own row-height/content), so a caller building a merged table writes 'restart' on the top cell and 'continue' on the corresponding cell in every row it covers.
  set verticalMerge(value: DocxVerticalMerge | undefined) {
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

  // Cell background fill (ECMA-376 w:tcPr/w:shd) -- w:val="clear" + w:color="auto" + w:fill=RRGGBB is the form ooxml.js's own reader accepts (it reads w:fill alone, treating "auto"/"none" as no fill). The write-side inverse of readCellShading, whose ContentTableCell.background this mirrors.
  get background(): Color | undefined {
    const tcPr = this.tcPrElement(false);
    const shd =
      tcPr === undefined ? undefined : directChildElement(tcPr, "w:shd");
    const fill = shd === undefined ? undefined : attr(shd, "w:fill");
    if (fill === undefined || fill === "auto" || fill === "none") {
      return undefined;
    }
    return rgbHexToColor(fill);
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

  // Per-edge cell borders (ECMA-376 w:tcPr/w:tcBorders) -- each present edge is a w:top/w:left/w:bottom/w:right child carrying w:val (single/dashed/dotted/double), w:sz (eighth-points), w:color (RRGGBB). The write-side inverse of readCellBorders, whose ContentTableCell.borders this mirrors; the bridge bypasses PDF, so the border STYLE (solid/dashed/dotted/double) is carried too -- valid here even though PDF-pivot conversions render every border solid.
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

  // w:trPr must be the FIRST child of w:tr (ECMA-376 CT_Row: trPr?, tblPrEx?, tc+), ahead of every w:tc -- a fixed-prefix invariant this row-property helper enforces by unshift, the same approach DocxTableCell.tcPrElement uses for w:tcPr inside w:tc.
  private trPrElement(create: boolean): XmlElement | undefined {
    const existing = directChildElement(this.node, "w:trPr");
    if (existing !== undefined || !create) {
      return existing;
    }
    const created = el("w:trPr");
    this.node.children.unshift(created);
    return created;
  }

  cells(): DocxTableCell[] {
    const out: DocxTableCell[] = [];
    for (const child of this.node.children) {
      if (child.type === "element" && child.tag === "w:tc") {
        out.push(new DocxTableCell(child));
      }
    }
    return out;
  }

  // Row height (ECMA-376 w:trPr/w:trHeight, value in twentieths-of-a-point). w:hRule="atLeast" preserves the source's intent -- a minimum row height that grows to fit taller content -- without clipping it the way "exact" would; odf.js's own reader resolves an ODF row height the same way (style:row-height is the value, content can still grow the row). This is the only row property this editor models because it is the only one ContentTableRow carries. Genuinely bidirectional today: ooxml.js's own readTable populates ContentTableRow.heightPt from w:trHeight and its writer emits w:trHeight back, so both the odt -> docx and docx -> odt bridges carry a row height through -- the latter via OdtTableRow's own heightPt getter/setter (src/edit/odt/table.ts), the ODF-side mirror of this one.
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

  // Merges colSpan grid columns of THIS row into one cell (ECMA-376 w:tcPr/w:gridSpan on the surviving anchor cell) -- the horizontal-merge primitive docx genuinely lacks today, unlike vertical merge, which is already a pure attribute setter on an existing w:tc (DocxTableCell.verticalMerge above). Docx omits a w:tc entirely for a column consumed by a merge (no covered-cell placeholder the way ODF has), so making this cell span colSpan columns means REMOVING the consumed cells' own w:tc elements from the row outright. Consumed cells' own content is discarded silently and unconditionally -- no check, no guard -- matching OdsSheet.mergeCells' own established precedent (src/edit/ods/sheet.ts) exactly: this is documented, intentional behaviour, not a silent trap.
  mergeCellsHorizontally(
    startColumnIndex: number,
    colSpan: number,
  ): DocxTableCell {
    if (!Number.isInteger(colSpan) || colSpan < 1) {
      throw new Error(
        `mergeCellsHorizontally: colSpan must be a positive integer, got ${colSpan}`,
      );
    }
    const cellElements: XmlElement[] = [];
    for (const child of this.node.children) {
      if (child.type === "element" && child.tag === "w:tc") {
        cellElements.push(child);
      }
    }
    const anchorElement = cellElements[startColumnIndex];
    if (anchorElement === undefined) {
      throw new Error(
        `mergeCellsHorizontally: column ${startColumnIndex} does not exist in this row`,
      );
    }
    if (startColumnIndex + colSpan > cellElements.length) {
      throw new Error(
        `mergeCellsHorizontally: colSpan ${colSpan} starting at column ${startColumnIndex} exceeds this row's own ${cellElements.length} columns`,
      );
    }
    for (let i = 1; i < colSpan; i++) {
      const consumedElement = cellElements[startColumnIndex + i];
      if (consumedElement !== undefined) {
        removeChild(this.node.children, consumedElement);
      }
    }
    const anchor = new DocxTableCell(anchorElement);
    anchor.colSpan = colSpan;
    return anchor;
  }
}

function buildCell(): XmlElement {
  return el("w:tc", {}, [buildParagraph()]);
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

  rows(): DocxTableRow[] {
    const out: DocxTableRow[] = [];
    for (const child of this.live().children) {
      if (child.type === "element" && child.tag === "w:tr") {
        out.push(new DocxTableRow(child));
      }
    }
    return out;
  }

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

  // Merges the rowSpan x colSpan rectangle anchored at (startRow, startColumn): pure sugar over DocxTableRow.mergeCellsHorizontally plus the already-existing verticalMerge attribute setter, not a new primitive of its own. Scoped to a table where every row still has one w:tc per grid column up to this point (no pre-existing narrower merge already consumed a cell this rectangle needs) -- docx's own per-row gridSpan means every covered row, not just the anchor row, needs its own horizontal merge to consume the same columns before vMerge marks it as a continuation.
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
    const rows = this.rows();
    const anchorRow = rows[startRow];
    if (anchorRow === undefined) {
      throw new Error(
        `mergeCells: row ${startRow} does not exist in this table`,
      );
    }
    const anchor = anchorRow.mergeCellsHorizontally(startColumn, colSpan);
    if (rowSpan > 1) {
      anchor.verticalMerge = "restart";
      for (let r = 1; r < rowSpan; r++) {
        const coveredRow = rows[startRow + r];
        if (coveredRow === undefined) {
          throw new Error(
            `mergeCells: rowSpan ${rowSpan} starting at row ${startRow} exceeds this table's own ${rows.length} rows`,
          );
        }
        const coveredAnchor = coveredRow.mergeCellsHorizontally(
          startColumn,
          colSpan,
        );
        coveredAnchor.verticalMerge = "continue";
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
