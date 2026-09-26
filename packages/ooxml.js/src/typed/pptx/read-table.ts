import type {
  ContentBorder,
  ContentCellBorders,
  ContentCellFill,
  ContentCellPatternType,
  ContentStrokeStyle,
  ContentTable,
  ContentTableCell,
} from "document-schema.js";
import type { Relationship } from "../util";
import type { SlideInheritanceContext } from "./inherit";
import type { XmlElement } from "../../model/node";
import { attr, childrenWithTag } from "../util";
import { emuToPt } from "../shared/units";
import { readSolidFillColor } from "../shared/drawingml";
import { textBodyParagraphs } from "./read";
// The table-reading family of the pptx reader, split from read.ts: DrawingML dash-style and pattern maps, cell border/fill/vertical-align readers, and the table reader itself. read.ts keeps shapes, runs, notes and the slide walk.
// DrawingML's own preset dash vocabulary (a:prstDash/@val, ECMA-376 20.1.10.48) has no 'double' member — documents.js's own src/edit/drawingml/vector.ts notes this same gap on the write side — and several of its members are dash-dot variants ContentStrokeStyle's four values can't distinguish individually, so each collapses onto whichever of solid/dashed/dotted it visually resembles most closely: the same "narrow to the closest matching value" convention typed/docx/read.ts's own BORDER_STYLE_MAP and typed/xlsx/styles.ts's own border-style table already apply to their own formats' larger enumerations.
export const DRAWINGML_DASH_STYLE_MAP: ReadonlyMap<string, ContentStrokeStyle> =
  new Map([
    ["solid", "solid"],
    ["dot", "dotted"],
    ["sysDot", "dotted"],
    ["dash", "dashed"],
    ["sysDash", "dashed"],
    ["lgDash", "dashed"],
    ["dashDot", "dashed"],
    ["sysDashDot", "dashed"],
    ["lgDashDot", "dashed"],
    ["sysDashDotDot", "dashed"],
    ["lgDashDotDot", "dashed"],
  ]);

// One a:tcPr child among a:lnL/a:lnR/a:lnT/a:lnB (ECMA-376 21.1.3.2-5, each a CT_LineProperties) — the DrawingML table cell's own per-edge border, the pptx-side counterpart to WordprocessingML's w:tcBorders edges (typed/docx/read.ts's readCellBorderEdge). @w is the edge's width in EMU and an a:solidFill child names its colour, resolved through the same scheme-colour-aware readSolidFillColor this cell's own background fill already uses rather than the write side's own srgbClr-only shortcut (src/edit/pptx/table.ts), so a theme-coloured border resolves correctly too; an optional a:prstDash child names its dash pattern, and @cmpd="dbl" (ST_CompoundLine, ECMA-376 20.1.2.2.24) names a double line — the one ContentStrokeStyle member a:prstDash cannot spell, so it takes priority over any a:prstDash also present, the same "@cmpd wins" convention src/edit/pptx/table.ts's own readBorderStyle follows. An edge missing @w, whose @w doesn't resolve to a positive number (non-numeric, zero, or negative), or whose colour doesn't resolve (no a:solidFill, or one this reader can't resolve to a Color — including an explicit a:noFill), reads as no border on that side: ContentBorderSchema requires both a resolved colour and a positive widthPt, so an edge failing either has no valid ContentBorder to construct — unlike WordprocessingML's own readCellBorderEdge, which defaults an absent width to half a point and an absent colour to black rather than dropping the edge, since w:tcBorders only ever omits @w:sz/@w:color on a genuine (non-nil/none) edge.
export function readTableCellBorderEdge(
  tcPr: XmlElement,
  tag: "a:lnL" | "a:lnR" | "a:lnT" | "a:lnB",
  context: SlideInheritanceContext,
): ContentBorder | undefined {
  const lnElement = childrenWithTag(tcPr, tag)[0];
  if (lnElement === undefined) {
    return undefined;
  }
  // An absent @w needs no guard of its own: Number(undefined) is NaN, emuToPt(NaN) is still NaN, and the finiteness check below already rejects that the same way it rejects a non-numeric or non-positive @w.
  const w = attr(lnElement, "w");
  const widthPt = emuToPt(Number(w));
  if (!Number.isFinite(widthPt) || widthPt <= 0) {
    return undefined;
  }
  const solidFill = childrenWithTag(lnElement, "a:solidFill")[0];
  const color = readSolidFillColor(solidFill, context.colorMap, context.theme);
  if (color === undefined) {
    return undefined;
  }
  const prstDash = childrenWithTag(lnElement, "a:prstDash")[0];
  const dashVal = prstDash === undefined ? undefined : attr(prstDash, "val");
  const style: ContentStrokeStyle | undefined =
    attr(lnElement, "cmpd") === "dbl"
      ? "double"
      : dashVal === undefined
        ? undefined
        : (DRAWINGML_DASH_STYLE_MAP.get(dashVal) ?? "solid");
  return {
    color,
    widthPt,
    style,
  };
}

// a:tcPr's own a:lnL/a:lnR/a:lnT/a:lnB (ECMA-376 21.1.3.2-5) — the pptx-side counterpart to WordprocessingML's w:tcBorders (typed/docx/read.ts's readCellBorders). Returns undefined when the cell carries no a:tcPr at all, or a:tcPr with every edge unresolvable, matching readCellBorders' own "no information vs information-but-empty are the same absent result" convention.
export function readTableCellBorders(
  tcPr: XmlElement | undefined,
  context: SlideInheritanceContext,
): ContentCellBorders | undefined {
  if (tcPr === undefined) {
    return undefined;
  }
  const left = readTableCellBorderEdge(tcPr, "a:lnL", context);
  const right = readTableCellBorderEdge(tcPr, "a:lnR", context);
  const top = readTableCellBorderEdge(tcPr, "a:lnT", context);
  const bottom = readTableCellBorderEdge(tcPr, "a:lnB", context);
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

// DrawingML's a:pattFill preset pattern vocabulary (ECMA-376 Part 1 20.1.8.36, ST_PresetPatternVal) has 54 members — directional hatches (horz/vert/diag and their light/dark/narrow/dashed variants), checks, grids, bricks, diamonds, and pictorial fills (sphere/wave/weave/divot/shingle/plaid/zigZag/confetti among them) — but ContentCellPatternTypeSchema is deliberately closed to exactly two other vocabularies (WordprocessingML's ST_Shd and SpreadsheetML's ST_PatternType, per that schema's own comment in document-schema.js), which the two share only their dozen percentage-density members. Only that overlap maps; every other preset resolves to no background at all, matching the existing "unrecognised token -> no fill" convention this reader already applies to an a:solidFill it cannot resolve to a Color.
export const DRAWINGML_PATTERN_PERCENT_MAP: ReadonlyMap<
  string,
  ContentCellPatternType
> = new Map([
  ["pct5", "percent5"],
  ["pct10", "percent10"],
  ["pct20", "percent20"],
  ["pct25", "percent25"],
  ["pct30", "percent30"],
  ["pct40", "percent40"],
  ["pct50", "percent50"],
  ["pct60", "percent60"],
  ["pct70", "percent70"],
  ["pct75", "percent75"],
  ["pct80", "percent80"],
  ["pct90", "percent90"],
]);

// A DrawingML a:pattFill's own two-colour density fill (ECMA-376 20.1.8.36 CT_PatternFillProperties): @prst names the pattern, and a:fgClr/a:bgClr each wrap a colour choice the same way a:solidFill itself does, so both resolve through the same scheme-colour-aware readSolidFillColor a cell's own solid background and border colours already use. Returns undefined for a preset outside DRAWINGML_PATTERN_PERCENT_MAP's mapped subset — ContentCellFillSchema's 'pattern' variant needs a real patternType to be worth constructing at all, and there is no member here to fall back to.
export function readPatternFill(
  pattFillEl: XmlElement,
  context: SlideInheritanceContext,
): ContentCellFill | undefined {
  const prst = attr(pattFillEl, "prst");
  const patternType =
    prst === undefined ? undefined : DRAWINGML_PATTERN_PERCENT_MAP.get(prst);
  if (patternType === undefined) {
    return undefined;
  }
  const fgClr = childrenWithTag(pattFillEl, "a:fgClr")[0];
  const bgClr = childrenWithTag(pattFillEl, "a:bgClr")[0];
  const foregroundColor = readSolidFillColor(
    fgClr,
    context.colorMap,
    context.theme,
  );
  const backgroundColor = readSolidFillColor(
    bgClr,
    context.colorMap,
    context.theme,
  );
  return {
    kind: "pattern",
    patternType,
    ...(foregroundColor === undefined ? {} : { foregroundColor }),
    ...(backgroundColor === undefined ? {} : { backgroundColor }),
  };
}

// A cell's own background fill: a:solidFill first (the common case, and the only one #951 originally wired up), falling back to a:pattFill so a genuine two-colour pattern (ExaDev/documents.js#1024) reads as a real 'pattern' ContentCellFill rather than as no background at all. The two are mutually exclusive DrawingML fill choices, so checking solidFill's presence to decide which to read is safe.
export function readTableCellFill(
  tcPr: XmlElement | undefined,
  context: SlideInheritanceContext,
): ContentCellFill | undefined {
  if (tcPr === undefined) {
    return undefined;
  }
  const solidFill = childrenWithTag(tcPr, "a:solidFill")[0];
  if (solidFill !== undefined) {
    const color = readSolidFillColor(
      solidFill,
      context.colorMap,
      context.theme,
    );
    return color === undefined ? undefined : { kind: "solid", color };
  }
  const pattFill = childrenWithTag(tcPr, "a:pattFill")[0];
  return pattFill === undefined
    ? undefined
    : readPatternFill(pattFill, context);
}

// a:tcPr/@anchor (ECMA-376 21.1.3.8, ST_TextAnchoringType) — the pptx-side counterpart to ODF's style:vertical-align (odf.js's typed/shared/table.ts, PIVOT_VERTICAL_ALIGN_BY_ODF) and RTF's \clvertalt/\clvertalc/\clvertalb, all three converging on ContentTableCell.verticalAlign's own three-member vocabulary. ST_TextAnchoringType has five members — t/ctr/b plus just and dist — but "just" (justified, first and last lines flush to both edges) and "dist" (distributed, every line evenly spaced) describe how multiple lines fill the cell's vertical extent, not a position among three discrete slots, so neither has a pivot equivalent to map onto; both are left unread here, the same "no member to guess at" convention isVerticalAlign applies in odf.js. An anchor attribute absent entirely, or set to just/dist, both read as undefined.
export const PIVOT_VERTICAL_ALIGN_BY_ANCHOR: ReadonlyMap<
  string,
  NonNullable<ContentTableCell["verticalAlign"]>
> = new Map([
  ["t", "top"],
  ["ctr", "center"],
  ["b", "bottom"],
]);

export function readTableCellVerticalAlign(
  tcPr: XmlElement | undefined,
): ContentTableCell["verticalAlign"] {
  if (tcPr === undefined) {
    return undefined;
  }
  const anchor = attr(tcPr, "anchor");
  return anchor === undefined
    ? undefined
    : PIVOT_VERTICAL_ALIGN_BY_ANCHOR.get(anchor);
}

// One a:tc as the ContentTableCell at its own grid position (ContentTable's grid rule, document-schema.js). DrawingML states a merged-away position as a real a:tc marked hMerge="1" or vMerge="1" (both, for the interior of a region wider and taller than one cell), and it carries an a:tcPr of its own, so the fill, borders and vertical alignment come from a:tcPr for a covered position exactly as for an anchor. A covered position holds no blocks and no spans: its content and the region's spans belong to the anchor a:tc.
export function readTableCell(
  tc: XmlElement,
  context: SlideInheritanceContext,
  slideRels: ReadonlyMap<string, Relationship>,
): ContentTableCell {
  const tcPr = childrenWithTag(tc, "a:tcPr")[0];
  const background = readTableCellFill(tcPr, context);
  const borders = readTableCellBorders(tcPr, context);
  const verticalAlign = readTableCellVerticalAlign(tcPr);
  if (attr(tc, "hMerge") === "1" || attr(tc, "vMerge") === "1") {
    return { blocks: [], background, borders, verticalAlign };
  }
  const txBody = childrenWithTag(tc, "a:txBody")[0];
  const gridSpan = attr(tc, "gridSpan");
  const rowSpan = attr(tc, "rowSpan");
  return {
    blocks: textBodyParagraphs(txBody, undefined, context, slideRels),
    colSpan: gridSpan === undefined ? undefined : Number(gridSpan),
    rowSpan: rowSpan === undefined ? undefined : Number(rowSpan),
    background,
    borders,
    verticalAlign,
  };
}

export function readTable(
  tbl: XmlElement,
  context: SlideInheritanceContext,
  slideRels: ReadonlyMap<string, Relationship>,
): ContentTable {
  const tblGrid = childrenWithTag(tbl, "a:tblGrid")[0];
  const columns =
    tblGrid === undefined
      ? []
      : childrenWithTag(tblGrid, "a:gridCol").map((col) => {
          const w = attr(col, "w");
          return { widthPt: w === undefined ? 0 : emuToPt(Number(w)) };
        });
  const rows = childrenWithTag(tbl, "a:tr").map((tr) => {
    const h = attr(tr, "h");
    return {
      cells: childrenWithTag(tr, "a:tc").map((tc) =>
        readTableCell(tc, context, slideRels),
      ),
      heightPt: h === undefined ? undefined : emuToPt(Number(h)),
    };
  });
  return { kind: "table", rows, columns };
}
