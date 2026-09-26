import type {
  ContentCellBorders,
  ContentTable,
  ContentTableCell,
} from "document-schema.js";
import { DocxWriteDiagnosticCodes } from "./diagnostics";
import { STROKE_STYLE_KEYWORD } from "./write";
import { buildBlockFlow } from "./write-constructs";
import type { WriteState } from "./write";
import type { XmlElement } from "../../model/node";
import { buildCellShading } from "./shading";
import {
  colorToRgbHex,
  describeTableGridFault,
  findTableGridFault,
  tableCellColumnSpan,
  tableCellRowSpan,
  walkTableGrid,
} from "document-schema.js";
import { el } from "../../xml/fragment";
import { ptToEighthPoints, ptToTwips } from "../shared/units";
// The table-writing family of the docx writer, split from write.ts: cell borders, shading-composed cells, dropped-header-column reporting and the table builder itself. write.ts keeps the run/paragraph/construct flow and the package assembly.
export function buildCellBorders(borders: ContentCellBorders): XmlElement {
  const edges: XmlElement[] = [];
  const edge = (tag: string, border: ContentCellBorders["top"]): void => {
    if (border === undefined) {
      return;
    }
    // ContentBorder.style is optional and document-schema.js defines its absence as meaning solid, so an absent style writes the solid keyword rather than no w:val — w:val is what makes a w:tcBorders edge a border at all.
    const style = border.style ?? "solid";
    edges.push(
      el(tag, {
        "w:val": STROKE_STYLE_KEYWORD[style],
        "w:sz": String(ptToEighthPoints(border.widthPt)),
        "w:color": colorToRgbHex(border.color),
      }),
    );
  };
  edge("w:top", borders.top);
  edge("w:left", borders.left);
  edge("w:bottom", borders.bottom);
  edge("w:right", borders.right);
  return el("w:tcBorders", {}, edges);
}

export function buildCell(
  cell: ContentTableCell,
  state: WriteState,
  deleted: boolean,
  gridSpan: number,
  vMerge: "restart" | "continue" | undefined,
): XmlElement {
  const tcPrChildren: XmlElement[] = [];
  if (gridSpan > 1) {
    tcPrChildren.push(el("w:gridSpan", { "w:val": String(gridSpan) }));
  }
  if (vMerge === "restart") {
    tcPrChildren.push(el("w:vMerge", { "w:val": "restart" }));
  } else if (vMerge === "continue") {
    tcPrChildren.push(el("w:vMerge"));
  }
  if (cell.background !== undefined) {
    tcPrChildren.push(buildCellShading(cell.background));
  }
  if (cell.borders !== undefined) {
    tcPrChildren.push(buildCellBorders(cell.borders));
  }
  const content = buildBlockFlow(cell.blocks, state, deleted);
  // ECMA-376 requires a cell to end with a block-level element, so an empty cell (a vertical-merge continuation, or a genuinely blank one) still gets an empty paragraph.
  const body = content.length === 0 ? [el("w:p")] : content;
  return el("w:tc", {}, [
    ...(tcPrChildren.length === 0 ? [] : [el("w:tcPr", {}, tcPrChildren)]),
    ...body,
  ]);
}

// A column's own isHeader (ContentTableColumn, ExaDev/documents.js#1381) is reported through state.onDiagnostic rather than written: w:tblGrid has no header-column marker at all, so the column's own cells are written exactly like any other column and only the flag is dropped. Reported once per flagged column, naming its index, matching ppt-codec's/documents.js's own pptx TABLE_HEADER_COLUMN_DROPPED precedent (src/drawing/shapes-write.ts, src/edit/pptx/content.ts) for the identical field.
export function reportDroppedHeaderColumns(
  table: ContentTable,
  state: WriteState,
): void {
  table.columns.forEach((column, columnIndex) => {
    if (column.isHeader === true) {
      state.onDiagnostic(
        {
          code: DocxWriteDiagnosticCodes.TABLE_HEADER_COLUMN_DROPPED,
          severity: "warning",
          message: `buildDocxPackageFromContent: table column ${String(columnIndex)} is a header column, and that is dropped; w:tblGrid has no header-column marker, so the column is written exactly as any other`,
        },
        { sourcePath: table.sourcePath },
      );
    }
  });
}

// Vertical merges are written back the way ECMA-376 spells them — a w:vMerge restart on the anchor and a bare w:vMerge below it — derived from the anchors' own rowSpan, which is exactly what readTable derived that rowSpan from. Horizontal merges are the asymmetric half: ECMA-376 has no element for a column a w:gridSpan already reaches, so a position covered along its own row contributes no w:tc at all, while a position covered from an earlier row contributes one at the covering anchor's first column and none at the rest, carrying that anchor's gridSpan so the continuation is exactly as wide as the cell it continues.
export function buildTable(
  table: ContentTable,
  state: WriteState,
  deleted: boolean,
): XmlElement {
  const gridFault = findTableGridFault(table);
  if (gridFault !== undefined) {
    throw new Error(
      `buildDocxPackageFromContent: table breaks the grid rule (${describeTableGridFault(gridFault)})`,
    );
  }
  // w:tblGrid has no element for a column repeating at the left of each printed page (docx has no header-column concept at all), so column.isHeader is never written here — reported through state.onDiagnostic instead (ExaDev/documents.js#1398), once per flagged column, before the grid itself is built.
  reportDroppedHeaderColumns(table, state);
  const grid = el(
    "w:tblGrid",
    {},
    table.columns.map((column) =>
      el("w:gridCol", { "w:w": String(ptToTwips(column.widthPt)) }),
    ),
  );
  const gridPositions = walkTableGrid(table);
  const rows = table.rows.map((row, rowIndex) => {
    const cells: XmlElement[] = [];
    for (const position of gridPositions[rowIndex]!) {
      if (position.anchorRowIndex === undefined) {
        const rowSpan = tableCellRowSpan(position.cell);
        cells.push(
          buildCell(
            position.cell,
            state,
            deleted,
            tableCellColumnSpan(position.cell),
            rowSpan > 1 ? "restart" : undefined,
          ),
        );
        continue;
      }
      const anchor =
        gridPositions[position.anchorRowIndex]![position.anchorColumnIndex]!;
      // No "anchorRowIndex < rowIndex" check ahead of the column comparison: walkTableGrid only ever assigns a covered position's anchorColumnIndex to a STRICTLY earlier column within the same row (columns are walked left to right, so a same-row anchor's own column is always used up before a later covered position reaches it), so a horizontally-covered position (anchorRowIndex === rowIndex) can never also satisfy columnIndex === anchorColumnIndex — the column comparison alone already excludes it, the same "covered along its own row contributes no w:tc" case this branch's own doc comment above names.
      if (position.columnIndex === position.anchorColumnIndex) {
        cells.push(
          buildCell(
            position.cell,
            state,
            deleted,
            tableCellColumnSpan(anchor.cell),
            "continue",
          ),
        );
      }
    }
    // w:trHeight is written before w:tblHeader because that is the order CT_TrPr's own property list runs in (cnfStyle, divId, gridBefore, gridAfter, wBefore, wAfter, cantSplit, trHeight, tblHeader, tblCellSpacing, jc, hidden), transcribed from the schema by python-docx's CT_TrPr._tag_seq and not guessed at here. The reader finds each child by tag rather than by position, so nothing on this side depends on the order; a real consumer reading the file might.
    const trProperties = [
      ...(row.heightPt === undefined
        ? []
        : [el("w:trHeight", { "w:val": String(ptToTwips(row.heightPt)) })]),
      // An on/off property states itself by being present: no w:val is the same as w:val="true", and the reader's own readToggle reads it back that way.
      ...(row.isHeader === true ? [el("w:tblHeader", {})] : []),
    ];
    const trPr =
      trProperties.length === 0 ? undefined : el("w:trPr", {}, trProperties);
    return el("w:tr", {}, [...(trPr === undefined ? [] : [trPr]), ...cells]);
  });
  const tblPr = el("w:tblPr", {}, [
    el("w:tblW", { "w:w": "0", "w:type": "auto" }),
  ]);
  return el("w:tbl", {}, [tblPr, grid, ...rows]);
}
