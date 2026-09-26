import { COLOR_BLACK, denseTableRows, rgbHexToColor } from "document-schema.js";
import type {
  ContentBlock,
  ContentBorder,
  ContentCellBorders,
  ContentCellFill,
  ContentParagraphBorders,
  ContentStrokeStyle,
  ContentTable,
  PositionedTableCell,
} from "document-schema.js";
import type { DocxReadContext } from "./read";
import type { XmlElement } from "../../model/node";
import { attr, childrenWithTag } from "../util";
import { eighthPointsToPt, twipsToPt } from "../shared/units";
import { readToggle } from "./read";
import { readBlockScope } from "./read-flow";
import { readCellShading } from "./shading";
// The table-reading family of the docx reader, split from read.ts: border maps and edge readers, raw cells, row heights and header flags, and the table reader itself. read.ts keeps paragraph and section flow.
// WordprocessingML's own ST_Border enumeration has several dozen decorative line styles (wave, threeDEmboss, dashDotStroked, ...) that ContentBorder's four-member ContentStrokeStyle can't distinguish individually — each maps to whichever of solid/dashed/dotted/double it visually resembles most closely, the same "narrow to the closest matching value" convention readAlignment (styles.ts) already applies to w:jc's own both/distribute -> justify. Anything unmapped defaults to 'solid' rather than being dropped, since a border with an unrecognised style is still visually a border.
export const BORDER_STYLE_MAP: ReadonlyMap<string, ContentStrokeStyle> =
  new Map([
    ["single", "solid"],
    ["thick", "solid"],
    ["triple", "solid"],
    ["outset", "solid"],
    ["inset", "solid"],
    ["threeDEmboss", "solid"],
    ["threeDEngrave", "solid"],
    ["dashed", "dashed"],
    ["dashSmallGap", "dashed"],
    ["dashDotStroked", "dashed"],
    ["dotDash", "dashed"],
    ["dotted", "dotted"],
    ["dotDotDash", "dotted"],
    ["double", "double"],
    ["doubleWave", "double"],
  ]);

// ECMA-376's own default border width whenever @w:sz is present on a genuine (non-nil/none) edge but the attribute itself is absent — 4 eighths of a point, i.e. half a point, the width Word's own UI defaults a newly-applied border to.
export const DEFAULT_BORDER_WIDTH_EIGHTH_POINTS = 4;

// One w:tcBorders child (w:top/w:left/w:right/w:bottom): @w:val is the line style ('nil'/'none' means no border on that edge, mirroring readCellShading's own 'auto'/'none' treatment), @w:sz is the width in eighths of a point (ST_EighthPointMeasure — see units.ts's own EIGHTH_POINTS_PER_POINT comment for why this isn't the half-point w:sz font-size uses), and @w:color is a 6-hex-digit RGB value or 'auto' (resolved to black, matching real Word rendering of an unspecified/automatic border colour).
export function readCellBorderEdge(
  tcBorders: XmlElement | undefined,
  tag: string,
): ContentBorder | undefined {
  const edge =
    tcBorders === undefined ? undefined : childrenWithTag(tcBorders, tag)[0];
  const val = edge === undefined ? undefined : attr(edge, "w:val");
  if (
    edge === undefined ||
    val === undefined ||
    val === "nil" ||
    val === "none"
  ) {
    return undefined;
  }
  const sz = attr(edge, "w:sz");
  const colorVal = attr(edge, "w:color");
  const color =
    colorVal === undefined || colorVal === "auto"
      ? COLOR_BLACK
      : rgbHexToColor(colorVal);
  return {
    color,
    widthPt: eighthPointsToPt(
      sz === undefined ? DEFAULT_BORDER_WIDTH_EIGHTH_POINTS : Number(sz),
    ),
    style: BORDER_STYLE_MAP.get(val) ?? "solid",
  };
}

// w:left/w:right also accept the RTL-neutral w:start/w:end aliases, mirroring resolveParagraphProperties' own w:ind/@w:left-vs-@w:start handling in styles.ts. Returns undefined (rather than an all-undefined object) when the cell declares no w:tcBorders at all, or declares one with every edge nil/none — distinguishing "no border information present" from "borders explicitly present but empty" isn't meaningful here, so both collapse to the same absent result (readCellBorderEdge already takes XmlElement | undefined, so an absent w:tcBorders needs no early return of its own: every edge reads undefined and the empty-borders check below returns the same undefined).
export function readCellBorders(
  tcPr: XmlElement | undefined,
): ContentCellBorders | undefined {
  const tcBorders =
    tcPr === undefined ? undefined : childrenWithTag(tcPr, "w:tcBorders")[0];
  const borders: ContentCellBorders = {};
  const left =
    readCellBorderEdge(tcBorders, "w:left") ??
    readCellBorderEdge(tcBorders, "w:start");
  const right =
    readCellBorderEdge(tcBorders, "w:right") ??
    readCellBorderEdge(tcBorders, "w:end");
  const top = readCellBorderEdge(tcBorders, "w:top");
  const bottom = readCellBorderEdge(tcBorders, "w:bottom");
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
  return Object.keys(borders).length === 0 ? undefined : borders;
}

// w:pBdr's own child tags are top/left/bottom/right (plus between/bar, neither read here — both describe borders shared with an adjacent paragraph, not this paragraph's own frame). Unlike w:tcBorders, CT_PBdr has no w:start/w:end RTL-neutral aliases (ECMA-376 Part 1 17.3.1.24), so readParagraphBorders reads w:left/w:right directly rather than falling back to them the way readCellBorders does. Reuses readCellBorderEdge's identical val/sz/color parsing — the two element shapes share the same attribute vocabulary, only the parent tag and the member set differ.
export function readParagraphBorders(
  pPr: XmlElement | undefined,
): ContentParagraphBorders | undefined {
  const pBdr =
    pPr === undefined ? undefined : childrenWithTag(pPr, "w:pBdr")[0];
  // The same absent-parent reasoning as readCellBorders: an absent w:pBdr needs no early return, every edge reads undefined, and the empty-borders check returns the same undefined.
  const borders: ContentParagraphBorders = {};
  const left = readCellBorderEdge(pBdr, "w:left");
  const right = readCellBorderEdge(pBdr, "w:right");
  const top = readCellBorderEdge(pBdr, "w:top");
  const bottom = readCellBorderEdge(pBdr, "w:bottom");
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
  return Object.keys(borders).length === 0 ? undefined : borders;
}

export interface RawCell {
  readonly gridSpan: number;
  readonly isVMergeContinuation: boolean;
  readonly background: ContentCellFill | undefined;
  readonly borders: ContentCellBorders | undefined;
  readonly blocks: ContentBlock[];
}

// w:vMerge's own presence-without-@w:val means "continue" (per ECMA-376, "restart" must be explicit) — distinct from no w:vMerge element at all, which means this cell isn't part of any vertical merge.
export function readRawCell(
  tc: XmlElement,
  ctx: DocxReadContext,
  carryDeletions: boolean,
): RawCell {
  const tcPr = childrenWithTag(tc, "w:tcPr")[0];
  const gridSpanEl =
    tcPr === undefined ? undefined : childrenWithTag(tcPr, "w:gridSpan")[0];
  const gridSpanVal =
    gridSpanEl === undefined ? undefined : attr(gridSpanEl, "w:val");
  const vMerge =
    tcPr === undefined ? undefined : childrenWithTag(tcPr, "w:vMerge")[0];
  const vMergeVal =
    vMerge === undefined ? undefined : (attr(vMerge, "w:val") ?? "continue");
  return {
    gridSpan: gridSpanVal === undefined ? 1 : Number(gridSpanVal),
    isVMergeContinuation: vMergeVal === "continue",
    background: readCellShading(tcPr),
    borders: readCellBorders(tcPr),
    // A cell's own block list is its own construct-marker bracket scope, exactly as document-schema.js's bracket-matching contract requires: a pair opened inside a cell closes inside that cell, and never straddles the list containing the table.
    blocks: readBlockScope(tc.children, ctx, carryDeletions),
  };
}

// w:trHeight@w:val is in twips (ECMA-376 17.4.81); absent when the row has no explicit height, in which case heightPt stays undefined and the consumer falls back to its own default — matching how readPageSize/readMargins leave pageSize/margins untouched rather than synthesising a value.
export function readRowHeightPt(tr: XmlElement): number | undefined {
  const trPr = childrenWithTag(tr, "w:trPr")[0];
  if (trPr === undefined) {
    return undefined;
  }
  const trHeight = childrenWithTag(trPr, "w:trHeight")[0];
  const val = trHeight === undefined ? undefined : attr(trHeight, "w:val");
  return val === undefined ? undefined : twipsToPt(Number(val));
}

// w:tblHeader (ECMA-376 17.4.78) is the docx spelling of ContentTableRow.isHeader: this row repeats at the top of each page the table continues onto. It is an on/off property, so a present element with no w:val is on, and w:val="0"/"false" turns it off again — the standard ST_OnOff reading every other w:trPr toggle takes, not a bare presence check that would read an explicitly-disabled toggle as enabled.
//
// The flag is read for the row it sits on whatever the rows above it say. Word itself honours a mid-table w:tblHeader only when every row above is also marked, but that is a rendering rule rather than a reading one, and flattening the shape on the way in would lose what the file actually states before any writer could act on it.
export function readRowIsHeader(tr: XmlElement): boolean {
  const trPr = childrenWithTag(tr, "w:trPr")[0];
  return readToggle(
    trPr === undefined ? undefined : childrenWithTag(trPr, "w:tblHeader")[0],
  );
}

// Column indices account for preceding cells' own gridSpan (a spanned cell occupies multiple grid columns); a vMerge-restart anchor's rowSpan is computed by scanning subsequent rows for a "continue" cell at the same column index, matching the anchor's own gridSpan — ECMA-376 doesn't store the span count directly the way pptx's a:tc/@rowSpan does, so it must be derived.
//
// ECMA-376 spells a horizontal merge as ONE w:tc carrying w:gridSpan, with no element at all for the columns it covers, so those columns have no w:tc to read and are supplied by denseTableRows instead — the grid rule (document-schema.js's ContentTableCell) wants one cell per grid column whatever the source format stores. A w:vMerge continuation does have its own w:tc, and it becomes the cell at its own column rather than being dropped, which is what lets its shading and borders survive the read; the further columns its own w:gridSpan reaches are filled the same way the anchor's are.
export function readTable(
  tbl: XmlElement,
  ctx: DocxReadContext,
  carryDeletions: boolean,
): ContentTable {
  const tblGrid = childrenWithTag(tbl, "w:tblGrid")[0];
  const columns =
    tblGrid === undefined
      ? []
      : childrenWithTag(tblGrid, "w:gridCol").map((col) => ({
          widthPt: twipsToPt(Number(attr(col, "w:w") ?? 0)),
        }));

  const trs = childrenWithTag(tbl, "w:tr");
  const rawRows: RawCell[][] = trs.map((tr) =>
    childrenWithTag(tr, "w:tc").map((tc) =>
      readRawCell(tc, ctx, carryDeletions),
    ),
  );
  const rowColumnIndices: number[][] = rawRows.map((row) => {
    const indices: number[] = [];
    let col = 0;
    for (const cell of row) {
      indices.push(col);
      col += cell.gridSpan;
    }
    return indices;
  });

  const positioned = rawRows.map((row, rowIndex) => ({
    heightPt: readRowHeightPt(trs[rowIndex]!),
    // Absent rather than false when the row states no w:tblHeader, so a table with no header row reads back as the object a producer that has never heard of the flag would build.
    isHeader: readRowIsHeader(trs[rowIndex]!) ? true : undefined,
    cells: row.map((cell, cellIndex): PositionedTableCell => {
      const colIndex = rowColumnIndices[rowIndex]![cellIndex]!;
      if (cell.isVMergeContinuation) {
        return {
          columnIndex: colIndex,
          cell: {
            blocks: [],
            background: cell.background,
            borders: cell.borders,
          },
        };
      }
      let rowSpan = 1;
      for (let r = rowIndex + 1; r < rawRows.length; r++) {
        const matchIndex = rowColumnIndices[r]!.indexOf(colIndex);
        // Indexing with indexOf's -1 miss already yields undefined, so no ternary is needed — matchCell is RawCell | undefined either way.
        const matchCell = rawRows[r]![matchIndex];
        if (matchCell?.isVMergeContinuation !== true) {
          break;
        }
        rowSpan++;
      }
      return {
        columnIndex: colIndex,
        cell: {
          blocks: cell.blocks,
          colSpan: cell.gridSpan > 1 ? cell.gridSpan : undefined,
          rowSpan: rowSpan > 1 ? rowSpan : undefined,
          background: cell.background,
          borders: cell.borders,
        },
      };
    }),
  }));

  return {
    kind: "table",
    columns,
    rows: denseTableRows(positioned, columns.length),
  };
}
