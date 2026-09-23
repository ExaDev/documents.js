import type {
  Color,
  ContentBorder,
  ContentCellBorders,
  ContentStrokeStyle,
  ContentTableCell,
} from "document-schema.js";
import { rgbHexToColor } from "document-schema.js";
import type { XmlElement } from "ooxml.js";
import { attr } from "ooxml.js";
import type { Box } from "document-schema.js";
import { emuToPt, ptToEmu } from "../../model/units";
import { directChildElement, removeAttr, setAttr } from "../../xml/edit";
import { el } from "../../xml/fragment";
import { drawingMlColorHex } from "../drawingml/vector";
import type { DrawingParagraphInit } from "./shape";
import { buildDrawingParagraph, ROTATION_UNITS_PER_DEGREE } from "./shape";

export interface PptxTableInit {
  readonly rows: number;
  readonly columns: number;
  readonly columnWidthsPt?: readonly number[];
  // One entry per row, read back from ContentTableRow.heightPt (ECMA-376 a:tr/@h) — a row whose own entry is absent or whose caller supplies no array at all falls back to DEFAULT_ROW_HEIGHT_PT below, the same "no explicit width, share the default" convention columnWidthsPt already follows for columns.
  readonly rowHeightsPt?: readonly (number | undefined)[];
}

// Matches docx/odt's own DEFAULT_TABLE_WIDTH_TWIPS/DEFAULT_TABLE_WIDTH_PT convention (468pt, US Letter width minus 1in margins either side) — the content width a new table defaults to when no explicit column widths are given.
const DEFAULT_TABLE_WIDTH_PT = 468;
// PowerPoint always writes a real measured row height; a row whose own ContentTableRow carries no heightPt (or whose caller supplies no rowHeightsPt at all) gets this single-line placeholder instead.
const DEFAULT_ROW_HEIGHT_PT = 20;

const TABLE_GRAPHIC_URI =
  "http://schemas.openxmlformats.org/drawingml/2006/table";

// ContentTableCell.verticalAlign's own top/center/bottom vocabulary written as a:tcPr/@anchor's t/ctr/b — the pptx-side counterpart to odf.js's own ODF_VERTICAL_ALIGN_BY_PIVOT (typed/shared/table.ts) for the identical concept.
const PPTX_TABLE_CELL_VERTICAL_ALIGN_ANCHOR = {
  top: "t",
  center: "ctr",
  bottom: "b",
} as const satisfies Record<
  NonNullable<ContentTableCell["verticalAlign"]>,
  string
>;

// ContentBorder.style's own solid/dashed/dotted vocabulary written as a:prstDash/@val — a preset naturally read back by ooxml.js's own DRAWINGML_DASH_STYLE_MAP (typed/pptx/read.ts), so the two stay in step. 'double' is deliberately absent: a:prstDash has no 'double' member (ST_PresetLineDashVal, ECMA-376 20.1.10.48), so that style is instead carried on @cmpd rather than as a dash preset — see the borders getter/setter below.
const PPTX_BORDER_STYLE_TO_DASH_VAL: Readonly<
  Partial<Record<ContentStrokeStyle, string>>
> = {
  solid: "solid",
  dashed: "dash",
  dotted: "sysDot",
};

// The read-side inverse of PPTX_BORDER_STYLE_TO_DASH_VAL above, for PptxTableCell.readBorder below — deliberately narrower than ooxml.js's own DRAWINGML_DASH_STYLE_MAP (typed/pptx/read.ts), which also narrows several OOXML dash-dot variants this package never writes onto 'dashed'/'dotted'; any a:prstDash/@val this map doesn't recognise falls back to 'solid', matching that same "narrow to the closest matching value" convention.
const DASH_VAL_TO_PPTX_BORDER_STYLE: ReadonlyMap<string, ContentStrokeStyle> =
  new Map([
    ["solid", "solid"],
    ["dash", "dashed"],
    ["sysDot", "dotted"],
  ]);

// a:lnL/a:lnR/a:lnT/a:lnB's own @cmpd value (ST_CompoundLine, ECMA-376 20.1.2.2.24) for a 'double' ContentBorder.style — the one ContentStrokeStyle member a:prstDash cannot spell.
const PPTX_BORDER_CMPD_DOUBLE = "dbl";

// The read-side inverse of PPTX_TABLE_CELL_VERTICAL_ALIGN_ANCHOR above, for PptxTableCell.verticalAlign's own getter.
const ANCHOR_TABLE_CELL_VERTICAL_ALIGN: ReadonlyMap<
  string,
  NonNullable<ContentTableCell["verticalAlign"]>
> = new Map([
  ["t", "top"],
  ["ctr", "center"],
  ["b", "bottom"],
]);

// A live view over a DrawingML table cell (a:tc) — the ContentTable-cell-shaped counterpart to DocxTableCell/OdtTableCell (src/edit/docx/table.ts, src/edit/odt/table.ts), but for a table living inside a slide's own p:graphicFrame rather than a document body. Unlike docx's gridSpan-collapses-the-row model, and matching ODF's covered-table-cell model in spirit, a DrawingML table's own a:tr always carries exactly `columns` a:tc elements regardless of merges (ooxml.js's own readTable confirms this: every row is `childrenWithTag(tr, "a:tc").map(readTableCell)` with no gridSpan-based skipping) — a merge is expressed purely via attributes on the covered cell's own a:tc (hMerge/vMerge, boolean "1"), never by omitting or replacing the element the way docx/ODF each do in their own way.
export class PptxTableCell {
  constructor(private readonly node: XmlElement) {}

  get element(): XmlElement {
    return this.node;
  }

  get colSpan(): number | undefined {
    const value = attr(this.node, "gridSpan");
    return value === undefined ? undefined : Number(value);
  }

  set colSpan(value: number | undefined) {
    if (value === undefined) {
      removeAttr(this.node, "gridSpan");
      return;
    }
    setAttr(this.node, "gridSpan", String(value));
  }

  get rowSpan(): number | undefined {
    const value = attr(this.node, "rowSpan");
    return value === undefined ? undefined : Number(value);
  }

  set rowSpan(value: number | undefined) {
    if (value === undefined) {
      removeAttr(this.node, "rowSpan");
      return;
    }
    setAttr(this.node, "rowSpan", String(value));
  }

  // Marks this cell as covered by a merge starting to its LEFT, in the same row (ECMA-376 a:tc/@hMerge).
  set horizontalMerge(value: boolean) {
    if (value) {
      setAttr(this.node, "hMerge", "1");
    } else {
      removeAttr(this.node, "hMerge");
    }
  }

  // Marks this cell as covered by a merge starting ABOVE it, in an earlier row (ECMA-376 a:tc/@vMerge). A cell covered by a merge that is both wider and taller than one cell carries both horizontalMerge and verticalMerge set, matching real PowerPoint output for the interior/trailing cells of a rectangular merge.
  set verticalMerge(value: boolean) {
    if (value) {
      setAttr(this.node, "vMerge", "1");
    } else {
      removeAttr(this.node, "vMerge");
    }
  }

  // a:tcPr is the cell's own properties container (ECMA-376 21.1.3.8) — find-or-create it, since every setter below either reads from or writes into it. buildTableCellElement already creates an empty a:tcPr as the cell's last child, so this is find-most-of-the-time rather than create-often.
  private tcPrElement(create: true): XmlElement;
  private tcPrElement(create: false): XmlElement | undefined;
  private tcPrElement(create: boolean): XmlElement | undefined {
    const existing = directChildElement(this.node, "a:tcPr");
    if (existing !== undefined || !create) {
      return existing;
    }
    const created = el("a:tcPr");
    this.node.children.push(created);
    return created;
  }

  // a:tcPr/a:solidFill/a:srgbClr@val — the cell's fill colour, read back by ooxml.js's own readTableCell (typed/pptx/read.ts) via readSolidFillColor. The hex is uppercase to match what real PowerPoint itself emits (a:srgbClr/@val is case-insensitive); rgbHexToColor parses either case identically.
  get background(): Color | undefined {
    const tcPr = this.tcPrElement(false);
    if (tcPr === undefined) {
      return undefined;
    }
    const solidFill = directChildElement(tcPr, "a:solidFill");
    const srgbClr =
      solidFill === undefined
        ? undefined
        : directChildElement(solidFill, "a:srgbClr");
    const hex = srgbClr === undefined ? undefined : attr(srgbClr, "val");
    return hex === undefined ? undefined : rgbHexToColor(hex);
  }

  set background(value: Color | undefined) {
    const tcPr = this.tcPrElement(true);
    const existing = directChildElement(tcPr, "a:solidFill");
    if (existing !== undefined) {
      tcPr.children.splice(tcPr.children.indexOf(existing), 1);
    }
    if (value === undefined) {
      return;
    }
    tcPr.children.push(
      el("a:solidFill", {}, [
        el("a:srgbClr", { val: drawingMlColorHex(value) }),
      ]),
    );
  }

  // a:tcPr children a:lnL/a:lnR/a:lnT/a:lnB (ECMA-376 21.1.3.2/3/4/5) — the four cell-border edges. Each a:lnX carries @w in EMU, an a:solidFill/a:srgbClr child naming the border colour, and an optional a:prstDash child (ECMA-376 20.1.10.48's ST_PresetLineDashVal) naming a non-solid dash pattern; a 'double' style has no a:prstDash member at all, so it is instead stated on @cmpd (ECMA-376 20.1.2.2.24's ST_CompoundLine, the same attribute a:ln itself carries), which this cell-border edge shares because a:lnL/a:lnR/a:lnT/a:lnB are all typed CT_LineProperties, the identical complex type a:ln uses. ooxml.js's own readTableCell reads all of this too (its own readTableCellBorders, resolved through the scheme-colour-aware readSolidFillColor rather than this setter's own srgbClr-only shortcut, and its own DRAWINGML_DASH_STYLE_MAP plus @cmpd check for the identical solid/dashed/dotted/double vocabulary), so a border's colour, width, and stroke style written here round-trip through both this package's own reader below and ooxml.js's.
  get borders(): ContentCellBorders | undefined {
    const tcPr = this.tcPrElement(false);
    if (tcPr === undefined) {
      return undefined;
    }
    const left = this.readBorder(directChildElement(tcPr, "a:lnL"));
    const right = this.readBorder(directChildElement(tcPr, "a:lnR"));
    const top = this.readBorder(directChildElement(tcPr, "a:lnT"));
    const bottom = this.readBorder(directChildElement(tcPr, "a:lnB"));
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

  set borders(value: ContentCellBorders | undefined) {
    const tcPr = this.tcPrElement(true);
    for (const tag of ["a:lnL", "a:lnR", "a:lnT", "a:lnB"] as const) {
      const existing = directChildElement(tcPr, tag);
      if (existing !== undefined) {
        tcPr.children.splice(tcPr.children.indexOf(existing), 1);
      }
    }
    if (value === undefined) {
      return;
    }
    const edges: readonly (readonly [
      keyof ContentCellBorders,
      "a:lnL" | "a:lnR" | "a:lnT" | "a:lnB",
    ])[] = [
      ["left", "a:lnL"],
      ["right", "a:lnR"],
      ["top", "a:lnT"],
      ["bottom", "a:lnB"],
    ];
    for (const [key, tag] of edges) {
      const border = value[key];
      if (border === undefined) {
        continue;
      }
      // a:solidFill must precede a:prstDash on CT_LineProperties (ECMA-376 20.1.2.2.24's own child sequence: fill, then dash, then join, then head/tail-end).
      const lineChildren: XmlElement[] = [
        el("a:solidFill", {}, [
          el("a:srgbClr", { val: drawingMlColorHex(border.color) }),
        ]),
      ];
      const dashVal =
        border.style === undefined
          ? undefined
          : PPTX_BORDER_STYLE_TO_DASH_VAL[border.style];
      if (dashVal !== undefined) {
        lineChildren.push(el("a:prstDash", { val: dashVal }));
      }
      const lineAttrs: Record<string, string> = {
        w: String(ptToEmu(border.widthPt)),
      };
      if (border.style === "double") {
        lineAttrs.cmpd = PPTX_BORDER_CMPD_DOUBLE;
      }
      tcPr.children.push(el(tag, lineAttrs, lineChildren));
    }
  }

  // a:tcPr/@anchor (ECMA-376 21.1.3.8, ST_TextAnchoringType) — read back by ooxml.js's own readTableCellVerticalAlign (typed/pptx/read.ts), which this setter's vocabulary mirrors exactly. ST_TextAnchoringType's other two members, just/dist, describe how multiple lines fill the cell rather than a position among three discrete slots and have no member in ContentTableCell.verticalAlign's own three-value vocabulary to write from, matching odf.js's own PIVOT_VERTICAL_ALIGN_BY_ODF/ODF_VERTICAL_ALIGN_BY_PIVOT pair (typed/shared/table.ts) for the identical top/center/bottom concept.
  get verticalAlign(): ContentTableCell["verticalAlign"] {
    const tcPr = this.tcPrElement(false);
    if (tcPr === undefined) {
      return undefined;
    }
    const anchor = attr(tcPr, "anchor");
    return anchor === undefined
      ? undefined
      : ANCHOR_TABLE_CELL_VERTICAL_ALIGN.get(anchor);
  }

  set verticalAlign(value: ContentTableCell["verticalAlign"]) {
    if (value === undefined) {
      const tcPr = this.tcPrElement(false);
      if (tcPr !== undefined) {
        removeAttr(tcPr, "anchor");
      }
      return;
    }
    const tcPr = this.tcPrElement(true);
    setAttr(tcPr, "anchor", PPTX_TABLE_CELL_VERTICAL_ALIGN_ANCHOR[value]);
  }

  // Mirrors ooxml.js's own readTableCellBorderEdge (typed/pptx/read.ts) guard: @w missing, non-numeric, zero, or negative all leave no valid ContentBorder to construct, since ContentBorderSchema's widthPt is positive().
  private readBorder(
    lnElement: XmlElement | undefined,
  ): ContentBorder | undefined {
    if (lnElement === undefined) {
      return undefined;
    }
    const w = attr(lnElement, "w");
    if (w === undefined) {
      return undefined;
    }
    const widthPt = emuToPt(Number(w));
    if (!Number.isFinite(widthPt) || widthPt <= 0) {
      return undefined;
    }
    const solidFill = directChildElement(lnElement, "a:solidFill");
    const srgbClr =
      solidFill === undefined
        ? undefined
        : directChildElement(solidFill, "a:srgbClr");
    const hex = srgbClr === undefined ? undefined : attr(srgbClr, "val");
    if (hex === undefined) {
      return undefined;
    }
    const style = this.readBorderStyle(lnElement);
    return {
      color: rgbHexToColor(hex),
      widthPt,
      ...(style === undefined ? {} : { style }),
    };
  }

  // @cmpd="dbl" (ECMA-376 20.1.2.2.24's ST_CompoundLine) takes priority over a:prstDash: the two attributes are independent in the schema (a double line could in principle also carry a dash pattern), but ContentStrokeStyle's own flat enum has no way to state both at once, so a cmpd of 'dbl' always reads back as 'double' regardless of any a:prstDash also present. Absent from both reads back as no style at all (see the borders getter's own comment above for why 'solid' is written and read explicitly rather than folded into that same absent case).
  private readBorderStyle(
    lnElement: XmlElement,
  ): ContentStrokeStyle | undefined {
    if (attr(lnElement, "cmpd") === PPTX_BORDER_CMPD_DOUBLE) {
      return "double";
    }
    const prstDash = directChildElement(lnElement, "a:prstDash");
    const dashVal = prstDash === undefined ? undefined : attr(prstDash, "val");
    if (dashVal === undefined) {
      return undefined;
    }
    return DASH_VAL_TO_PPTX_BORDER_STYLE.get(dashVal) ?? "solid";
  }

  // Replaces this cell's own a:txBody paragraph content — mirrors PptxShape.setParagraphs (shape.ts) exactly, since a:tc's own a:txBody is the identical CT_TextBody content model a p:sp's is.
  setParagraphs(paragraphs: readonly DrawingParagraphInit[]): void {
    const txBody = directChildElement(this.node, "a:txBody");
    if (txBody === undefined) {
      return; // unreachable in practice — buildTableCellElement always creates one.
    }
    const nonParagraphChildren = txBody.children.filter(
      (c) => !(c.type === "element" && c.tag === "a:p"),
    );
    txBody.children = [
      ...nonParagraphChildren,
      ...paragraphs.map(buildDrawingParagraph),
    ];
  }
}

export class PptxTableRow {
  constructor(private readonly node: XmlElement) {}

  cells(): PptxTableCell[] {
    const out: PptxTableCell[] = [];
    for (const child of this.node.children) {
      if (child.type === "element" && child.tag === "a:tc") {
        out.push(new PptxTableCell(child));
      }
    }
    return out;
  }
}

// A live view over a DrawingML table (a:tbl) living inside a slide's own p:graphicFrame — built via PptxSlide.addTable (slide.ts), the pptx-side counterpart to a document-level DocxTable/OdtTable.
export class PptxTable {
  constructor(private readonly node: XmlElement) {}

  rows(): PptxTableRow[] {
    const out: PptxTableRow[] = [];
    for (const child of this.node.children) {
      if (child.type === "element" && child.tag === "a:tr") {
        out.push(new PptxTableRow(child));
      }
    }
    return out;
  }

  cell(rowIndex: number, columnIndex: number): PptxTableCell {
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
}

function buildTableCellElement(): XmlElement {
  return el("a:tc", {}, [
    el("a:txBody", {}, [
      el("a:bodyPr"),
      el("a:lstStyle"),
      el("a:p", {}, [el("a:endParaRPr")]),
    ]),
    el("a:tcPr"),
  ]);
}

function buildTblGrid(
  columns: number,
  columnWidthsPt?: readonly number[],
): XmlElement {
  const defaultWidth = DEFAULT_TABLE_WIDTH_PT / columns;
  const cols: XmlElement[] = [];
  for (let i = 0; i < columns; i++) {
    const widthPt = columnWidthsPt?.[i] ?? defaultWidth;
    cols.push(el("a:gridCol", { w: String(ptToEmu(widthPt)) }));
  }
  return el("a:tblGrid", {}, cols);
}

export function buildDrawingTable(init: PptxTableInit): XmlElement {
  const rows: XmlElement[] = [];
  for (let r = 0; r < init.rows; r++) {
    const cells: XmlElement[] = [];
    for (let c = 0; c < init.columns; c++) {
      cells.push(buildTableCellElement());
    }
    const heightPt = init.rowHeightsPt?.[r] ?? DEFAULT_ROW_HEIGHT_PT;
    rows.push(el("a:tr", { h: String(ptToEmu(heightPt)) }, cells));
  }
  return el("a:tbl", {}, [
    el("a:tblPr"),
    buildTblGrid(init.columns, init.columnWidthsPt),
    ...rows,
  ]);
}

// Builds the p:graphicFrame wrapping a DrawingML table — a genuinely different shape kind from PptxShape's own p:sp/p:pic (its own frame lives on a direct p:xfrm child, not nested inside a p:spPr the way p:sp/p:pic's does; see ooxml.js's own readGraphicFrameShape), which is why table shapes get their own PptxTable/PptxTableCell view rather than being squeezed into PptxShape's existing frame/rotationDeg accessors. rotationDeg follows the identical a:xfrm/@rot convention PptxShape.rotationDeg already documents (see shape.ts).
export function buildTableGraphicFrame(
  frame: Box,
  tableElement: XmlElement,
  shapeId: number,
  rotationDeg: number | undefined,
): XmlElement {
  const xfrmAttrs: Record<string, string> =
    rotationDeg === undefined || rotationDeg === 0
      ? {}
      : { rot: String(Math.round(rotationDeg * ROTATION_UNITS_PER_DEGREE)) };
  return el("p:graphicFrame", {}, [
    el("p:nvGraphicFramePr", {}, [
      el("p:cNvPr", { id: String(shapeId), name: `Table ${shapeId}` }),
      el("p:cNvGraphicFramePr"),
      el("p:nvPr"),
    ]),
    el("p:xfrm", xfrmAttrs, [
      el("a:off", {
        x: String(ptToEmu(frame.xPt)),
        y: String(ptToEmu(frame.yPt)),
      }),
      el("a:ext", {
        cx: String(ptToEmu(frame.widthPt)),
        cy: String(ptToEmu(frame.heightPt)),
      }),
    ]),
    el("a:graphic", {}, [
      el("a:graphicData", { uri: TABLE_GRAPHIC_URI }, [tableElement]),
    ]),
  ]);
}

// The read-side inverse of buildTableGraphicFrame: given a p:graphicFrame, returns its a:tbl element if — and only if — its a:graphic/a:graphicData carries the table URI, exactly the same uri === TABLE_GRAPHIC_URI check ooxml.js's own readGraphicFrameShape (typed/pptx/read.ts) already makes when deciding whether a graphic frame is a table. Returns undefined for a graphic frame holding a chart, SmartArt, or any other a:graphicData payload — PptxSlide.tables() uses this to filter p:spTree's children down to real tables only.
export function findGraphicFrameTable(
  graphicFrame: XmlElement,
): XmlElement | undefined {
  const graphic = directChildElement(graphicFrame, "a:graphic");
  const graphicData =
    graphic === undefined
      ? undefined
      : directChildElement(graphic, "a:graphicData");
  if (
    graphicData === undefined ||
    attr(graphicData, "uri") !== TABLE_GRAPHIC_URI
  ) {
    return undefined;
  }
  return directChildElement(graphicData, "a:tbl");
}
