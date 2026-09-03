// The <celldef> production's own cell formatting: borders, shading, and the two merge families (RTF 1.9.1, "Table Definitions").
//
// A <celldef> is the run of control words sitting before each \cellxN rather than a group of its own -- "there is no RTF table group; instead, tables are specified as paragraph properties" -- so the reader accumulates one of these as it walks and closes it at each \cellxN, and the writer emits one before each \cellxN it writes.
//
//   <celldef>  (\clmgf? & \clmrg? & \clvmgf? & \clvmrg? ... & <celltop>? & <cellleft>? & <cellbot>? & <cellright>? & <cellshad>? ...) \cellxN
//   <celltop>  \clbrdrt <brdr>
//   <brdr>     <brdrk> \brdrwN? \brspN? \brdrcfN?
//   <cellshad> <cellpat>? \clcfpatN? & \clcbpatN? & \clshdngN
//
// A border is therefore two-part: \clbrdrt names the side, and everything after it up to the next side (or the \cellxN) describes it. That is why a pending side is state rather than a parameter.

import type {
  Color,
  ContentBorder,
  ContentStrokeStyle,
} from "document-schema.js";
import { twipsToPoints, pointsToTwips } from "./units";

export type CellBorderSide = "top" | "left" | "bottom" | "right";

// The control word naming each side, from the <celltop>/<cellleft>/<cellbot>/<cellright> productions.
export const CELL_BORDER_SIDES: ReadonlyMap<string, CellBorderSide> = new Map([
  ["clbrdrt", "top"],
  ["clbrdrl", "left"],
  ["clbrdrb", "bottom"],
  ["clbrdrr", "right"],
]);

// The <brdrk> keywords, narrowed onto ContentStrokeStyle's four members. RTF names about thirty; most are decorative variants of one of the four (every \brdrdash* spelling is a dash, every thick-thin combination is a double rule), and a keyword with no member here is read as the 'solid' the field's own "absent means solid" default already states rather than being invented into a member it does not have.
const BORDER_STYLES: ReadonlyMap<string, ContentStrokeStyle> = new Map([
  ["brdrs", "solid"],
  ["brdrth", "solid"],
  ["brdrsh", "solid"],
  ["brdrhair", "solid"],
  ["brdrinset", "solid"],
  ["brdroutset", "solid"],
  ["brdrengrave", "solid"],
  ["brdremboss", "solid"],
  ["brdrdot", "dotted"],
  ["brdrdash", "dashed"],
  ["brdrdashsm", "dashed"],
  ["brdrdashd", "dashed"],
  ["brdrdashdd", "dashed"],
  ["brdrdashdot", "dashed"],
  ["brdrdashdotdot", "dashed"],
  ["brdrdashdotstr", "dashed"],
  ["brdrdb", "double"],
  ["brdrtriple", "double"],
  ["brdrwavydb", "double"],
  ["brdrtnthsg", "double"],
  ["brdrthtnsg", "double"],
  ["brdrtnthtnsg", "double"],
  ["brdrtnthmg", "double"],
  ["brdrthtnmg", "double"],
  ["brdrtnthtnmg", "double"],
  ["brdrtnthlg", "double"],
  ["brdrthtnlg", "double"],
  ["brdrtnthtnlg", "double"],
  ["brdrwavy", "solid"],
]);

// "\brdrnone No border", "\brdrnil No border specified", "\brdrtbl Table cell has no borders". All three state an absent border, which ContentCellBorders spells as an absent side rather than a zero-width one -- a border of width zero is not a border, and ContentBorderSchema requires a positive width anyway.
const NO_BORDER_KEYWORDS: ReadonlySet<string> = new Set([
  "brdrnone",
  "brdrnil",
  "brdrtbl",
]);

// "\brdrwN -- N is the width in twips of the pen used to draw the paragraph border line." Word's own default when a style keyword appears with no width beside it.
const DEFAULT_BORDER_WIDTH_TWIPS = 15;

export interface PendingBorder {
  style: ContentStrokeStyle | undefined;
  widthTwips: number | undefined;
  colorIndex: number | undefined;
  // Set by \brdrnone/\brdrnil/\brdrtbl: the side is explicitly stated to have no border, so it produces no entry at all.
  none: boolean;
}

export interface PendingCell {
  borders: Partial<Record<CellBorderSide, PendingBorder>>;
  // Which side the <brdr> control words currently being read describe, if any.
  side: CellBorderSide | undefined;
  // \clcbpatN -- "N is the background color of the background pattern", an index into the colour table.
  backgroundIndex: number | undefined;
  // "\clvmgf The first cell in a range of table cells to be vertically merged" / "\clvmrg Contents of the table cell are vertically merged with those of the preceding cell."
  verticalMergeFirst: boolean;
  verticalMergeContinuation: boolean;
  // The horizontal twins of the pair above.
  horizontalMergeFirst: boolean;
  horizontalMergeContinuation: boolean;
}

export function newPendingCell(): PendingCell {
  return {
    borders: {},
    side: undefined,
    backgroundIndex: undefined,
    verticalMergeFirst: false,
    verticalMergeContinuation: false,
    horizontalMergeFirst: false,
    horizontalMergeContinuation: false,
  };
}

// Applies one <celldef> control word. Returns whether it was one, so the caller can fall through to the paragraph and structure dispatches for everything else.
export function applyCellDefinitionControlWord(
  name: string,
  param: number | undefined,
  cell: PendingCell,
): boolean {
  const side = CELL_BORDER_SIDES.get(name);
  if (side !== undefined) {
    cell.side = side;
    cell.borders[side] = {
      style: undefined,
      widthTwips: undefined,
      colorIndex: undefined,
      none: false,
    };
    return true;
  }
  switch (name) {
    case "clvmgf":
      cell.verticalMergeFirst = true;
      return true;
    case "clvmrg":
      cell.verticalMergeContinuation = true;
      return true;
    case "clmgf":
      cell.horizontalMergeFirst = true;
      return true;
    case "clmrg":
      cell.horizontalMergeContinuation = true;
      return true;
    case "clcbpat":
      cell.backgroundIndex = param;
      return true;
    default:
      break;
  }
  const pending = cell.side === undefined ? undefined : cell.borders[cell.side];
  if (pending === undefined) {
    return false;
  }
  if (NO_BORDER_KEYWORDS.has(name)) {
    pending.none = true;
    return true;
  }
  const style = BORDER_STYLES.get(name);
  if (style !== undefined) {
    pending.style = style;
    return true;
  }
  if (name === "brdrw") {
    pending.widthTwips = param;
    return true;
  }
  if (name === "brdrcf") {
    pending.colorIndex = param;
    return true;
  }
  // \brspN and the other <brdr> members this package does not carry still belong to the border being described, so they are consumed rather than falling through to a paragraph property of the same name.
  return name.startsWith("brdr") || name.startsWith("brsp");
}

// The ContentBorder one pending side describes, or undefined when the side states no border at all. A side named by \clbrdrt with no <brdrk> after it is still a border -- Word writes that shape -- so an absent style takes the 'solid' the schema's own default names.
export function resolveBorder(
  pending: PendingBorder,
  colorAt: (index: number) => Color | undefined,
): ContentBorder | undefined {
  if (pending.none) {
    return undefined;
  }
  const widthPt = twipsToPoints(
    pending.widthTwips ?? DEFAULT_BORDER_WIDTH_TWIPS,
  );
  if (widthPt <= 0) {
    return undefined;
  }
  const color =
    pending.colorIndex === undefined ? undefined : colorAt(pending.colorIndex);
  const style = pending.style;
  return {
    // ContentBorderSchema requires a colour, and RTF's own index 0 is the "auto" colour with no RGB of its own -- which every consumer renders as black, so that is what an unstated border colour becomes here rather than the border being dropped for want of one.
    color: color ?? { r: 0, g: 0, b: 0 },
    widthPt,
    ...(style === undefined || style === "solid" ? {} : { style }),
  };
}

// The inverse, for the writer: one side's own `\clbrdr* <brdr>` text.
export function borderControlWords(
  side: CellBorderSide,
  border: ContentBorder,
  colorIndex: number | undefined,
): string {
  const sideWord = [...CELL_BORDER_SIDES].find(
    ([, value]) => value === side,
  )?.[0];
  if (sideWord === undefined) {
    return "";
  }
  const style = BORDER_STYLE_CONTROL_WORDS[border.style ?? "solid"];
  const width = Math.max(1, pointsToTwips(border.widthPt));
  return (
    `\\${sideWord}\\${style}\\brdrw${String(width)}` +
    (colorIndex === undefined ? "" : `\\brdrcf${String(colorIndex)}`)
  );
}

// One <brdrk> keyword per ContentStrokeStyle member, chosen as the plainest spelling of each: the read table above collapses about thirty keywords onto four members, so the write direction picks the canonical one rather than trying to recover which variant the source used.
const BORDER_STYLE_CONTROL_WORDS: Readonly<Record<ContentStrokeStyle, string>> =
  {
    solid: "brdrs",
    dashed: "brdrdash",
    dotted: "brdrdot",
    double: "brdrdb",
  };
