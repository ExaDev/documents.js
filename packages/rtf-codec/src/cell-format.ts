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
  ContentCellFill,
  ContentCellPatternType,
  ContentStrokeStyle,
} from "document-schema.js";
import { unrecognizedFillKind } from "document-schema.js";
import { twipsToPoints, pointsToTwips } from "./units";

// Every percentN member ContentCellPatternTypeSchema defines, ascending -- the discrete steps RTF's own continuous \clshdngN percentage (0-10000, i.e. 0-100% in hundredths) snaps onto, since the schema states a two-colour pattern fill only as one of these named densities, never an arbitrary float. A real producer overwhelmingly writes one of these exact values already (5/10/25/50/75/... are the common Word UI presets), so the snap is exact for the common case and a defensible nearest-match for the rare exact value this vocabulary has no member for.
const PERCENT_STEPS: readonly [number, ContentCellPatternType][] = [
  [5, "percent5"],
  [10, "percent10"],
  [12, "percent12"],
  [15, "percent15"],
  [20, "percent20"],
  [25, "percent25"],
  [30, "percent30"],
  [35, "percent35"],
  [37, "percent37"],
  [40, "percent40"],
  [45, "percent45"],
  [50, "percent50"],
  [55, "percent55"],
  [60, "percent60"],
  [62, "percent62"],
  [65, "percent65"],
  [70, "percent70"],
  [75, "percent75"],
  [80, "percent80"],
  [85, "percent85"],
  [87, "percent87"],
  [90, "percent90"],
  [95, "percent95"],
];

// The nearest percentN member to an arbitrary 0-100 shading percentage.
function nearestPercentType(percent: number): ContentCellPatternType {
  return PERCENT_STEPS.reduce((best, step) =>
    Math.abs(step[0] - percent) < Math.abs(best[0] - percent) ? step : best,
  )[1];
}

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
  // \clcfpatN -- the pattern's own foreground colour index, the other half of the two-colour pattern \clshdngN's percentage blends against.
  foregroundIndex: number | undefined;
  // \clshdngN -- the shading percentage, in hundredths of a percent (0-10000 per the control word's own definition), 0-100 once divided down. Undefined (not stated at all) means 0, matching the same "clcbpat alone is a flat background colour" shape every RTF cell without genuine two-colour shading already writes.
  shadingPercent: number | undefined;
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
    foregroundIndex: undefined,
    shadingPercent: undefined,
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
    case "clcfpat":
      cell.foregroundIndex = param;
      return true;
    case "clshdng":
      // "N is defined in hundredths of a percent, from 0 to 10000" -- divided down to the same 0-100 scale nearestPercentType and resolveCellFill both work in.
      cell.shadingPercent = param === undefined ? undefined : param / 100;
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

// The cell's own background fill, resolved from \clcbpatN/\clcfpatN/\clshdngN together (ExaDev/documents.js#1024): \clshdngN's own percentage states how much of the pattern's foreground (\clcfpatN) shows over its background (\clcbpatN) -- the identical weighted-blend convention LibreOffice's own RTF import filter uses ("nColor*nShading/100 + nFillColor*(100-nShading)/100"), confirmed against that real, independent implementation rather than assumed. A shading of 0 (or, as every RTF cell without \clshdngN at all writes it, simply absent) is the pre-existing "flat background colour" shape -- \clcbpatN alone, no pattern -- and a shading of 100 is the mirror case, a flat fill of the foreground colour instead; only a shading strictly between the two is a genuine two-colour pattern, snapped to the nearest percentN member via nearestPercentType. Returns undefined when the cell states no background at all (\clcbpatN absent), matching resolveBorder's own "nothing stated, nothing returned" convention.
export function resolveCellFill(
  pending: PendingCell,
  colorAt: (index: number) => Color | undefined,
): ContentCellFill | undefined {
  if (pending.backgroundIndex === undefined) {
    return undefined;
  }
  const backgroundColor = colorAt(pending.backgroundIndex);
  const shading = pending.shadingPercent ?? 0;
  if (shading <= 0) {
    return backgroundColor === undefined
      ? undefined
      : { kind: "solid", color: backgroundColor };
  }
  const foregroundColor =
    pending.foregroundIndex === undefined
      ? undefined
      : colorAt(pending.foregroundIndex);
  if (shading >= 100) {
    return foregroundColor === undefined
      ? undefined
      : { kind: "solid", color: foregroundColor };
  }
  return {
    kind: "pattern",
    patternType: nearestPercentType(shading),
    ...(foregroundColor === undefined ? {} : { foregroundColor }),
    ...(backgroundColor === undefined ? {} : { backgroundColor }),
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

/** The inverse of PERCENT_STEPS, keyed by patternType. */
const PERCENT_TYPE_TO_VALUE: ReadonlyMap<ContentCellPatternType, number> =
  new Map(
    PERCENT_STEPS.map(([percent, patternType]) => [patternType, percent]),
  );

// The inverse of resolveCellFill: a ContentCellFill's own \clcbpatN/\clcfpatN/\clshdngN text. A 'solid' fill writes \clcbpatN alone -- the identical shape every RTF cell with a flat background colour and no genuine shading already writes, so this does not regress the pre-#1024 output for the overwhelmingly common case. A 'pattern' fill writes all three: \clcbpatN for backgroundColor, \clcfpatN for foregroundColor, and \clshdngN for the percentage PERCENT_TYPE_TO_VALUE names for that patternType, scaled back up to hundredths of a percent. RTF's own shading model is a flat two-colour percentage blend with no named stripe/cross/grid concept at all -- unlike ST_Shd/ST_PatternType, which this same pattern-fill vocabulary also serves and which DO have real tokens for those -- so a patternType outside the percentN family throws rather than silently collapsing to one colour the way this writer did before #1024, the identical "throw for a construct this format's own vocabulary cannot state" contract buildCellShading (ooxml.js's docx side) already keeps for the mirror case (a SpreadsheetML-only pattern name ST_Shd has no member for). colorIndexOf resolves each half's own colour to its table index; a fill whose colour resolves to no index at all (the colour table has no room, or the caller's own colorIndexOf declines it) writes no control word for that half, exactly as the pre-existing \clcbpat writer already did.
export function cellFillControlWords(
  fill: ContentCellFill,
  colorIndexOf: (color: Color) => number | undefined,
): string {
  switch (fill.kind) {
    case "solid": {
      const index = colorIndexOf(fill.color);
      return index === undefined ? "" : `\\clcbpat${String(index)}`;
    }
    case "pattern": {
      const percent = PERCENT_TYPE_TO_VALUE.get(fill.patternType);
      if (percent === undefined) {
        throw new Error(
          `rtf-codec cannot write a '${fill.patternType}' cell fill: RTF's own \\clshdngN is a flat two-colour percentage blend with no named stripe/cross/grid pattern of its own, and that pattern name belongs only to the ST_Shd/ST_PatternType half of ContentCellPatternType's shared vocabulary`,
        );
      }
      const backgroundIndex =
        fill.backgroundColor === undefined
          ? undefined
          : colorIndexOf(fill.backgroundColor);
      const foregroundIndex =
        fill.foregroundColor === undefined
          ? undefined
          : colorIndexOf(fill.foregroundColor);
      return (
        (backgroundIndex === undefined
          ? ""
          : `\\clcbpat${String(backgroundIndex)}`) +
        (foregroundIndex === undefined
          ? ""
          : `\\clcfpat${String(foregroundIndex)}`) +
        `\\clshdng${String(percent * 100)}`
      );
    }
    default:
      throw new Error(
        `rtf-codec cannot write a cell fill with kind '${unrecognizedFillKind(fill)}': ContentCellFillSchema's discriminated union only defines 'solid' and 'pattern'`,
      );
  }
}
