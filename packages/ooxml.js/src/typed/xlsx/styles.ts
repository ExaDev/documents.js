import type {
  Alignment,
  BorderWeight,
  Color,
  ContentBorder,
  ContentCellBorders,
  ContentCellFill,
  ContentCellPatternType,
  ContentStrokeStyle,
} from "document-schema.js";
import {
  BORDER_WIDTH_PT,
  borderWeightForWidthPt,
  colorToRgbHex,
  dashedBorderWeightForWidthPt,
  rgbHexToColor,
} from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import type { CellNumberFormat } from "./number-format";
import { attr, childrenWithTag, decodeEntities, rootElement } from "../util";
import { BUILTIN_NUMBER_FORMATS } from "excel-number-format";

// Resolves xl/styles.xml for typed/xlsx/content.ts (read) and typed/xlsx/build.ts (write). The read side produces one entry per <cellXfs><xf> -- the array index IS the value of a cell's own s attribute -- carrying everything ContentSheetCellSchema models that lives in a cell format: the number-format CODE STRING (resolved through <numFmts>, classified by typed/xlsx/number-format.ts upstream), and the cell DECORATION (background fill, per-edge borders, horizontal/vertical alignment) added in this same widening that gave ContentSheetCell its background/borders/alignment/verticalAlignment fields. The write side is the same relationship in reverse: CellFormatTable interns the (number format, decoration) tuples a written workbook needs, ready to serialize as <numFmts>/<fills>/<borders>/<cellXfs>.

const STYLES_PATH = "xl/styles.xml";

// numFmtId 0, 'General' -- CT_Xf/@numFmtId's own schema default, so an <xf> with no numFmtId attribute at all is General, not "unformatted". Shared by both directions: what the reader falls back to for an undeclared id, and what the writer's own default cell format carries.
export const GENERAL_NUM_FMT_ID = 0;

// numFmtId -> format code, built in exactly two feeds: ECMA-376's own built-in table first, then the file's own <numFmts> overlaid UNCONDITIONALLY. The overlay is unconditional rather than fill-the-gaps because a producer-declared code always wins over an implied one -- confirmed necessary against real LibreOffice output, whose kitchen-sink export declares id 164 as "General" and then points its plain numeric cells at it; a fill-the-gaps overlay would still be correct there, but nothing in the format stops a producer redeclaring an id inside the built-in range, and the spec's own table is the FALLBACK for ids a file leaves undeclared, not an authority over ids it declares.
function readNumberFormatCodesById(
  styleSheet: XmlElement,
): Map<number, string> {
  const codes = new Map<number, string>(BUILTIN_NUMBER_FORMATS);
  const numFmtsEl = childrenWithTag(styleSheet, "numFmts")[0];
  if (numFmtsEl === undefined) {
    return codes;
  }
  for (const numFmt of childrenWithTag(numFmtsEl, "numFmt")) {
    const idRaw = attr(numFmt, "numFmtId");
    const formatCode = attr(numFmt, "formatCode");
    if (idRaw === undefined || formatCode === undefined) {
      continue;
    }
    const id = Number.parseInt(idRaw, 10);
    if (Number.isInteger(id)) {
      // decodeEntities is load-bearing here, not defensive: this package's lossless layer keeps attribute values exactly as written, and a real format code routinely contains quoted literals -- LibreOffice's own boolean format arrives as `&quot;TRUE&quot;;&quot;TRUE&quot;;&quot;FALSE&quot;`, which would tokenize as bare code characters rather than as quoted text if fed through raw.
      codes.set(id, decodeEntities(formatCode));
    }
  }
  return codes;
}

// --- the read side: per-cellXfs number format + decoration --------------------------------------------------------

// Everything this reader resolves for one <cellXfs><xf> entry. numberFormatCode is the numFmt code string that xf displays its value through (undefined when the xf points at a numFmtId no code anywhere supplies); the four decoration fields mirror document-schema.js's own ContentSheetCellSchema fields of the same names, and are each undefined when the xf carries no real value for them -- matching the schema's own "absent means default" semantics for every one.
export interface CellStyleEntry {
  numberFormatCode?: string;
  background?: ContentCellFill;
  borders?: ContentCellBorders;
  alignment?: Alignment;
  verticalAlignment?: "top" | "middle" | "bottom";
}

// ST_PatternType's own seventeen non-solid, non-none members (ECMA-376 Part 1 SS18.18.55) -- the SpreadsheetML half of ContentCellPatternType's shared vocabulary, and (ExaDev/documents.js#951) the exact string spelling <patternFill patternType="..."/> already uses, so no translation table is needed the way doc-codec's Ipat and ooxml.js's own docx w:shd each need one: the attribute value IS the schema's own member name. Named as its own narrow type (rather than typing the guard below `value is ContentCellPatternType`) so a caller already holding a full ContentCellPatternType -- the write side, validating a real cell's own pattern name -- narrows its negative branch to the WordprocessingML-only remainder instead of `never`.
type XlsxPatternType = Extract<
  ContentCellPatternType,
  | "mediumGray"
  | "darkGray"
  | "lightGray"
  | "darkHorizontal"
  | "darkVertical"
  | "darkDown"
  | "darkUp"
  | "darkGrid"
  | "darkTrellis"
  | "lightHorizontal"
  | "lightVertical"
  | "lightDown"
  | "lightUp"
  | "lightGrid"
  | "lightTrellis"
  | "gray125"
  | "gray0625"
>;

const SPREADSHEETML_PATTERN_TYPES: ReadonlySet<string> =
  new Set<XlsxPatternType>([
    "mediumGray",
    "darkGray",
    "lightGray",
    "darkHorizontal",
    "darkVertical",
    "darkDown",
    "darkUp",
    "darkGrid",
    "darkTrellis",
    "lightHorizontal",
    "lightVertical",
    "lightDown",
    "lightUp",
    "lightGrid",
    "lightTrellis",
    "gray125",
    "gray0625",
  ]);

/** Whether `value` is one of ST_PatternType's own seventeen non-solid, non-none members -- the only ContentCellPatternType members a `<patternFill>` can ever name, so a value this returns true for can be used as a ContentCellPatternType directly with no further mapping. */
function isXlsxPatternType(value: string): value is XlsxPatternType {
  return SPREADSHEETML_PATTERN_TYPES.has(value);
}

// xlsx's border style attribute (CT_BorderStyle, ECMA-376 Part 1 SS18.18.3) conflates a stroke's PATTERN (solid/dashed/dotted/double) with its WEIGHT (hair/thin/medium/thick), unlike ODF's separate fo:border "<length> <style> <color>" shorthand or ContentBorderSchema's own widthPt+style pair. The weight half of that -- the named weights, their derived point widths, and the bucketing back from a widthPt to a name -- is document-schema.js's own border-weight module, imported above: BIFF8 quantises to the identical four weights, so xls-codec needs the same mapping and the two must not drift. What stays here is xlsx's own token vocabulary, which is genuinely format-specific.

// Each xlsx border-style token resolves to one weight (for widthPt) and one ContentStrokeStyle pattern. The dash-family tokens (dashDot/dashDotDot and their medium/slant variants) have no ContentStrokeStyle member that distinguishes them from a plain dashed line, so they collapse to 'dashed' rather than being dropped -- the closest faithful mapping, preserving "this edge is dashed" instead of degrading to solid. 'none' is handled by the caller (it means the edge carries no border at all) and has no entry here.
const XLSX_BORDER_STYLE: Readonly<
  Record<string, { weight: BorderWeight; pattern: ContentStrokeStyle }>
> = {
  thin: { weight: "thin", pattern: "solid" },
  medium: { weight: "medium", pattern: "solid" },
  thick: { weight: "thick", pattern: "solid" },
  hair: { weight: "hair", pattern: "solid" },
  dashed: { weight: "thin", pattern: "dashed" },
  dotted: { weight: "thin", pattern: "dotted" },
  double: { weight: "thin", pattern: "double" },
  mediumDashed: { weight: "medium", pattern: "dashed" },
  dashDot: { weight: "thin", pattern: "dashed" },
  mediumDashDot: { weight: "medium", pattern: "dashed" },
  dashDotDot: { weight: "thin", pattern: "dashed" },
  mediumDashDotDot: { weight: "medium", pattern: "dashed" },
  slantDashDot: { weight: "medium", pattern: "dashed" },
};

// A <color> element already located by its caller (one of a <border> edge's own colour, a <patternFill>'s <fgColor>/<bgColor>, or one of a colorScale's own several <color> siblings, which readColorRgb below cannot reach since it only ever takes the FIRST child of a given tag): only the rgb attribute is mapped (8 hex digits "AARRGGBB" with a leading alpha prefix, or 6 "RRGGBB" -- the last 6 digits are the real RGB in both forms). theme/indexed/tint/auto carry real colours this reader deliberately does not resolve: theme and indexed require a separate workbook-theme/table resolution this package does not model, and silently substituting black or any other fixed colour would misreport them, so the edge/fill reads as carrying no colour instead.
export function colorFromElement(
  colorEl: XmlElement | undefined,
): Color | undefined {
  if (colorEl === undefined) {
    return undefined;
  }
  const raw = attr(colorEl, "rgb");
  if (raw === undefined) {
    return undefined;
  }
  // Excel writes "FFRRGGBB" (alpha + RGB); a 6-digit "RRGGBB" is also spec-legal. Take the LAST six hex digits in both cases, since the alpha channel has no ContentSheetCell.background representation and a leading "FF" is the only prefix real producers emit.
  const hex = raw.length >= 6 ? raw.slice(-6) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return undefined;
  }
  try {
    return rgbHexToColor(hex);
  } catch {
    return undefined;
  }
}

// The common case: the FIRST child of `container` named `colorTag`, resolved through colorFromElement above. Exported for typed/xlsx/conditional-format.ts, which resolves a dxf's own <font><color/></font> and <fill><patternFill><bgColor/></patternFill></fill> through the identical "first child of this tag" shape cell decoration already uses here.
export function readColorRgb(
  container: XmlElement,
  colorTag: string,
): Color | undefined {
  return colorFromElement(childrenWithTag(container, colorTag)[0]);
}

// One <fill> -> a ContentCellFill (ExaDev/documents.js#951), or undefined for patternType="none" (or an absent/unrecognised patternType). For patternType="solid" the cell's visible background is the pattern's FOREGROUND colour (<fgColor>) per OOXML's solid-pattern semantics -- the whole cell is painted with the pattern's fg colour -- with <bgColor> as a fallback only when a producer left fgColor unset. This is the documented Excel/LibreOffice convention and what every real file's solid fill carries; reading bgColor first (the literal pattern-background) would return the wrong colour for the common case. Every other named ST_PatternType value (isXlsxPatternType above) resolves to a real 'pattern' fill, carrying whichever of <fgColor>/<bgColor> states a concrete colour -- either may be a theme/indexed/auto colour this reader does not resolve (colorFromElement's own note) and is then left unstated, matching ContentCellFillSchema's own "a colour can defer instead of asserting" convention.
function readFillBackground(fill: XmlElement): ContentCellFill | undefined {
  const patternFill = childrenWithTag(fill, "patternFill")[0];
  if (patternFill === undefined) {
    return undefined;
  }
  const patternType = attr(patternFill, "patternType");
  if (patternType === "solid") {
    const color =
      readColorRgb(patternFill, "fgColor") ??
      readColorRgb(patternFill, "bgColor");
    return color === undefined ? undefined : { kind: "solid", color };
  }
  if (patternType === undefined || !isXlsxPatternType(patternType)) {
    return undefined;
  }
  const foregroundColor = readColorRgb(patternFill, "fgColor");
  const backgroundColor = readColorRgb(patternFill, "bgColor");
  return {
    kind: "pattern",
    patternType,
    ...(foregroundColor !== undefined ? { foregroundColor } : {}),
    ...(backgroundColor !== undefined ? { backgroundColor } : {}),
  };
}

function readFills(
  styleSheet: XmlElement,
): readonly (ContentCellFill | undefined)[] {
  const fillsEl = childrenWithTag(styleSheet, "fills")[0];
  if (fillsEl === undefined) {
    return [];
  }
  return childrenWithTag(fillsEl, "fill").map(readFillBackground);
}

// One <border> edge -> a ContentBorder, or undefined when the edge has no style, style="none", or no resolvable colour. An absent style attribute means the edge genuinely carries no border (distinct from an absent <left> element, which means "say nothing about this edge" -- but a present <left/> with no style and no colour is how real producers spell "no left border", so both shapes collapse to undefined here, matching how readCellStyleDecoration in odf.js treats an explicit "none" token).
function readBorderEdge(
  border: XmlElement,
  edge: "left" | "right" | "top" | "bottom",
): ContentBorder | undefined {
  const edgeEl = childrenWithTag(border, edge)[0];
  if (edgeEl === undefined) {
    return undefined;
  }
  const styleToken = attr(edgeEl, "style");
  if (styleToken === undefined || styleToken === "none") {
    return undefined;
  }
  const resolved = XLSX_BORDER_STYLE[styleToken];
  if (resolved === undefined) {
    return undefined;
  }
  const color = readColorRgb(edgeEl, "color");
  if (color === undefined) {
    return undefined;
  }
  const result: ContentBorder = {
    color,
    widthPt: BORDER_WIDTH_PT[resolved.weight],
  };
  if (resolved.pattern !== "solid") {
    result.style = resolved.pattern;
  }
  return result;
}

function readBorders(
  styleSheet: XmlElement,
): readonly (ContentCellBorders | undefined)[] {
  const bordersEl = childrenWithTag(styleSheet, "borders")[0];
  if (bordersEl === undefined) {
    return [];
  }
  return childrenWithTag(bordersEl, "border").map((border) => {
    const left = readBorderEdge(border, "left");
    const right = readBorderEdge(border, "right");
    const top = readBorderEdge(border, "top");
    const bottom = readBorderEdge(border, "bottom");
    if (
      left === undefined &&
      right === undefined &&
      top === undefined &&
      bottom === undefined
    ) {
      return undefined;
    }
    const result: ContentCellBorders = {};
    if (left !== undefined) {
      result.left = left;
    }
    if (right !== undefined) {
      result.right = right;
    }
    if (top !== undefined) {
      result.top = top;
    }
    if (bottom !== undefined) {
      result.bottom = bottom;
    }
    return result;
  });
}

// horizontal="general" is xlsx's own "use the value-kind default" (numeric right, text left) -- the IDENTICAL semantics to ContentSheetCell.alignment being absent -- so it is left unread rather than mapped to a literal Alignment member that would override the default it is meant to request. start/end/distributed/fill have no Alignment member (the schema is left/center/right/justify), so they are left unread too, matching odf.js's readCellStyleDecoration policy of not guessing a value the schema has no member for. Only the four direct members survive.
function readHorizontalAlignment(alignment: XmlElement): Alignment | undefined {
  const value = attr(alignment, "horizontal");
  if (
    value === "left" ||
    value === "center" ||
    value === "right" ||
    value === "justify"
  ) {
    return value;
  }
  return undefined;
}

// vertical="center" maps to ContentSheetCell's own 'middle' member (the schema uses middle, not center). "bottom" is the documented default and is left unread (absent means 'bottom'); "top" survives; "justify"/"distributed"/"centerContinuous" have no member and are left unread.
function readVerticalAlignment(
  alignment: XmlElement,
): "top" | "middle" | "bottom" | undefined {
  const value = attr(alignment, "vertical");
  if (value === "top") {
    return "top";
  }
  if (value === "center") {
    return "middle";
  }
  return undefined;
}

function readAlignment(xf: XmlElement): {
  alignment?: Alignment;
  verticalAlignment?: "top" | "middle" | "bottom";
} {
  const alignment = childrenWithTag(xf, "alignment")[0];
  if (alignment === undefined) {
    return {};
  }
  return {
    alignment: readHorizontalAlignment(alignment),
    verticalAlignment: readVerticalAlignment(alignment),
  };
}

// One entry per <cellXfs><xf>, in document order, so the array index IS the value of a cell's own s attribute. numberFormatCode is read directly off the cellXf's numFmtId (not chased through xfId into <cellStyleXfs>: real producers write the resolved numFmtId onto the cellXf itself -- see the note on readCellFormatCodes below -- and the same holds for fillId/borderId/alignment, which this reader also reads off the cellXf directly). fillId/borderId resolve through the <fills>/<borders> tables; alignment is the inline <alignment> child. A cell whose xf carries applyAlignment="0" still reads its inline alignment here, matching the numFmtId policy and real producer output.
export function readCellStyles(pkg: Package): readonly CellStyleEntry[] {
  const styleSheet = rootElement(pkg.parts[STYLES_PATH]);
  if (styleSheet === undefined) {
    return [];
  }
  const cellXfsEl = childrenWithTag(styleSheet, "cellXfs")[0];
  if (cellXfsEl === undefined) {
    return [];
  }
  const codes = readNumberFormatCodesById(styleSheet);
  const fills = readFills(styleSheet);
  const borders = readBorders(styleSheet);
  return childrenWithTag(cellXfsEl, "xf").map((xf) => {
    const numFmtRaw = attr(xf, "numFmtId");
    const numFmtId =
      numFmtRaw === undefined
        ? GENERAL_NUM_FMT_ID
        : Number.parseInt(numFmtRaw, 10);
    const entry: CellStyleEntry = {};
    if (Number.isInteger(numFmtId)) {
      const code = codes.get(numFmtId);
      if (code !== undefined) {
        entry.numberFormatCode = code;
      }
    }
    const fillId = parseChildIndex(attr(xf, "fillId"));
    if (fillId !== undefined) {
      entry.background = fills[fillId];
    }
    const borderId = parseChildIndex(attr(xf, "borderId"));
    if (borderId !== undefined) {
      entry.borders = borders[borderId];
    }
    const { alignment, verticalAlignment } = readAlignment(xf);
    if (alignment !== undefined) {
      entry.alignment = alignment;
    }
    if (verticalAlignment !== undefined) {
      entry.verticalAlignment = verticalAlignment;
    }
    return entry;
  });
}

// One raw <dxf> element per <dxfs><dxf>, in document order -- the array index IS a cfRule's own dxfId attribute. Unlike <cellXfs> (interned across every CELL a workbook has, decoration and number format both), a <dxfs> entry exists only to serve conditionalFormatting rules and carries a genuinely different shape (font/fill/alignment/border/numFmt/protection as full override elements, not indices into shared tables), so this is a thin positional list handed to typed/xlsx/conditional-format.ts to resolve into ContentSheetConditionalFormatStyle, not another decoration cascade of this module's own.
export function readDxfElements(pkg: Package): readonly XmlElement[] {
  const styleSheet = rootElement(pkg.parts[STYLES_PATH]);
  if (styleSheet === undefined) {
    return [];
  }
  const dxfsEl = childrenWithTag(styleSheet, "dxfs")[0];
  if (dxfsEl === undefined) {
    return [];
  }
  return childrenWithTag(dxfsEl, "dxf");
}

// Parse a style-table index attribute (fillId/borderId) into a narrowed `number | undefined`, so the caller's `!== undefined` guard cleanly types the subsequent array index without relying on Number.isInteger being a type guard (it is not, in this TS lib version).
function parseChildIndex(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) ? n : undefined;
}

// The number-format-code-only projection of readCellStyles, kept for callers (and tests) that consumed the original per-cellXfs numFmt-code array. Each entry's numberFormatCode is the code string that cell's value is displayed through; everything else a styleSheet carries -- fonts, fills, borders, alignment, protection -- was outside this function's original return shape, and widening it now would break those callers, so readCellStyles is the richer entry point and this is its numFmt-only view.
export function readCellFormatCodes(
  pkg: Package,
): readonly (string | undefined)[] {
  return readCellStyles(pkg).map((entry) => entry.numberFormatCode);
}

// --- the write side: interning the cell formats a written workbook needs -------------------------------------------

// Where a file's own custom format ids start. ECMA-376 implies ids 0-49 (BUILTIN_NUMBER_FORMATS above) and reserves everything up to 163 for locale-specific built-ins a producer must not redefine; 164 is the first id a file may declare for itself, and is where every real producer starts -- this directory's own kitchen-sink.xlsx fixture declares its six formats as 164-169.
const FIRST_CUSTOM_NUM_FMT_ID = 164;

// The cell-format index every cell with nothing but General formatting and no decoration carries, and the one entry this table always starts with, so a workbook that needs no formats at all still writes exactly the single-<xf> cellXfs it did before this table existed.
export const DEFAULT_CELL_FORMAT_INDEX = 0;

// A custom format as it must be declared in <numFmts>: the id this table assigned it, and the code itself (raw, NOT XML-encoded -- the caller encodes when it writes the formatCode attribute, matching how every other string this package writes is handled).
export interface DeclaredNumberFormat {
  id: number;
  code: string;
}

// The reserved <fills> indices ECMA-376 producers write even when a workbook has no real fills: index 0 is the explicit "no fill" (<patternFill patternType="none"/>), index 1 is Excel's own mandatory gray125 background pattern, and real solid fills start at index 2. A workbook that declares any solid fill must still emit both reserved entries in order first, or Excel opens the file with a repair prompt.
const NONE_FILL_INDEX = 0;
const GRAY125_FILL_INDEX = 1;
const FIRST_REAL_FILL_INDEX = 2;

// The reserved <borders> index: index 0 is the explicit "no borders" entry (<border><left/><right/><top/><bottom/><diagonal/></border>) every real workbook declares, and real borders start at index 1.
const EMPTY_BORDER_INDEX = 0;
const FIRST_REAL_BORDER_INDEX = 1;

// A built-in id and a custom code can never collide as keys, since one signature space is numeric ids and the other is format-code text.
function signatureOfNumberFormat(format: CellNumberFormat): string {
  return format.kind === "builtin"
    ? `builtin:${format.id}`
    : `custom:${format.code}`;
}

// The four decoration fields a cell format can carry alongside its number format, mirroring CellStyleEntry's own shape. Each is optional and independently interned; a cell carrying none of them passes an empty object and shares the default xf with every other undecorated cell.
export interface CellFormatDecoration {
  background?: ContentCellFill;
  borders?: ContentCellBorders;
  alignment?: Alignment;
  verticalAlignment?: "top" | "middle" | "bottom";
}

const EMPTY_DECORATION: CellFormatDecoration = {};

// A deterministic signature for one ContentCellFill, shared by signatureOfDecoration (the cellXfs interning key) and CellFormatTable.internFill (the <fills> table's own dedup key) so the two can never disagree about which fills count as identical.
function fillSignature(fill: ContentCellFill): string {
  return fill.kind === "solid"
    ? `solid:${colorToRgbHex(fill.color)}`
    : `pattern:${fill.patternType}:${fill.foregroundColor === undefined ? "" : colorToRgbHex(fill.foregroundColor)}:${fill.backgroundColor === undefined ? "" : colorToRgbHex(fill.backgroundColor)}`;
}

/** Reads `.kind` off a ContentCellFill that has already been switched over both of its real members ('solid'/'pattern') -- TypeScript types such a value 'never' at that point, so this takes it through a deliberately widened parameter type rather than an `as` cast. A value that reaches this call anyway (a malformed object bypassing schema validation, or a stale caller shape) still carries a real, inspectable kind at runtime even though the type system says none is left to name. */
function unrecognizedFillKind(fill: { kind?: unknown }): string {
  return String(fill.kind);
}

// A deterministic signature for a decoration, so two cells carrying identical decoration share one xf entry. widthPt is encoded with enough precision to round-trip the named-weight widths above (0.5/0.75/1.5/2.25) without floating-point drift producing spurious distinct entries.
function signatureOfDecoration(decoration: CellFormatDecoration): string {
  let sig = "";
  if (decoration.background !== undefined) {
    sig += `|bg:${fillSignature(decoration.background)}`;
  }
  const borders = decoration.borders;
  if (borders !== undefined) {
    for (const edge of ["left", "right", "top", "bottom"] as const) {
      const border = borders[edge];
      if (border !== undefined) {
        sig += `|${edge}:${border.style ?? "solid"}:${colorToRgbHex(border.color)}:${border.widthPt.toFixed(4)}`;
      }
    }
  }
  if (decoration.alignment !== undefined) {
    sig += `|h:${decoration.alignment}`;
  }
  if (decoration.verticalAlignment !== undefined) {
    sig += `|v:${decoration.verticalAlignment}`;
  }
  return sig;
}

function borderToXlsxStyle(border: ContentBorder): string {
  // The inverse of XLSX_BORDER_STYLE above: pick the xlsx style token that carries this border's pattern at the closest named weight. 'double'/'dotted' patterns always have a direct token; 'dashed' and a solid border bucket their widthPt back to a named weight through document-schema.js's own shared quantisation, the same one the reader's widths came out of.
  switch (border.style) {
    case "double":
      return "double";
    case "dotted":
      return "dotted";
    case "dashed":
      return dashedBorderWeightForWidthPt(border.widthPt) === "medium"
        ? "mediumDashed"
        : "dashed";
    case "solid":
    case undefined:
      return borderWeightForWidthPt(border.widthPt);
  }
}

// One declared <fill> as the writer must emit it. 'none'/'gray125' are the two reserved scaffolding entries every real workbook declares regardless of content, carrying no colour; 'solid' carries its colour plus the indexed="64" bgColor that is Excel's own convention for "no separate background" on a solid pattern; 'pattern' is a genuine ContentCellPatternType fill a real cell asked for, carrying whichever of fgRgb/bgRgb its own foreground/background colours resolved to (ExaDev/documents.js#951) -- discriminated by `kind` rather than by `patternType` alone, since a real cell fill can itself name patternType "gray125" (or any other SpreadsheetML member), which is a wholly different, independently-coloured <fill> entry from the reserved scaffolding one of the identical name.
export type DeclaredFill =
  | { kind: "none" }
  | { kind: "gray125" }
  | { kind: "solid"; rgb: string }
  | {
      kind: "pattern";
      patternType: ContentCellPatternType;
      fgRgb?: string;
      bgRgb?: string;
    };

// One declared <border> as the writer must emit it: each present edge carries its xlsx style token and colour; absent edges emit an empty <edge/> element, matching the empty-border reserved entry's shape (every edge is always present as an element, just empty when there is no border).
export interface DeclaredBorder {
  edges: {
    left?: { style: string; rgb: string };
    right?: { style: string; rgb: string };
    top?: { style: string; rgb: string };
    bottom?: { style: string; rgb: string };
  };
}

// One resolved <cellXfs><xf> record: the numFmtId, fillId, borderId, and inline alignment the writer emits for that index, plus whether applyAlignment should be set. fontId/xfId are fixed (this writer interns no fonts and bases every cellXf on cellStyleXfs entry 0); numFmtId/fillId/borderId come straight from the three interning tables this class also drives.
export interface CellFormatRecord {
  numFmtId: number;
  fillId: number;
  borderId: number;
  alignment?: {
    horizontal?: Alignment;
    vertical?: "top" | "middle" | "bottom";
  };
}

// The write-side counterpart to readCellStyles above, and a direct mirror of shared-strings.ts's own SharedStringTable: typed/xlsx/build.ts fills it on demand while it walks cells, and it hands back a stable index each time -- the value of that cell's own `s` attribute, an index into <cellXfs>. What is deduplicated is the cell FORMAT as a whole: two cells wanting the same number format AND the same decoration share one xf entry, and two cells wanting the same custom CODE share one <numFmt> declaration too, exactly as a real producer's own output does. Fonts are single-entry throughout (one <font> in <fonts>), so a font never contributes to the interning key -- only number format and decoration distinguish one xf from another in what this writer produces.
export class CellFormatTable {
  private readonly indexBySignature = new Map<string, number>([
    [
      signatureOfNumberFormat({ kind: "builtin", id: GENERAL_NUM_FMT_ID }) +
        signatureOfDecoration(EMPTY_DECORATION),
      DEFAULT_CELL_FORMAT_INDEX,
    ],
  ]);
  private readonly records: CellFormatRecord[] = [
    {
      numFmtId: GENERAL_NUM_FMT_ID,
      fillId: NONE_FILL_INDEX,
      borderId: EMPTY_BORDER_INDEX,
    },
  ];
  private readonly declared: DeclaredNumberFormat[] = [];
  private readonly fillIndexBySignature = new Map<string, number>();
  private readonly fills: DeclaredFill[] = [
    { kind: "none" },
    { kind: "gray125" },
  ];
  private readonly borderIndexBySignature = new Map<string, number>();
  private readonly borders: DeclaredBorder[] = [{ edges: {} }];

  // Returns the (possibly newly assigned) cellXfs index that displays a value through `format` with `decoration` applied. A call with no decoration (the default) behaves exactly as this method did before decoration existed -- the default xf at index 0 for General, and one xf per distinct number format beyond that -- so existing callers and tests are unaffected.
  intern(
    format: CellNumberFormat,
    decoration: CellFormatDecoration = EMPTY_DECORATION,
  ): number {
    const signature =
      signatureOfNumberFormat(format) + signatureOfDecoration(decoration);
    const existing = this.indexBySignature.get(signature);
    if (existing !== undefined) {
      return existing;
    }
    const numFmtId =
      format.kind === "builtin"
        ? format.id
        : this.declareNumberFormat(format.code);
    const fillId =
      decoration.background === undefined
        ? NONE_FILL_INDEX
        : this.internFill(decoration.background);
    const borderId =
      decoration.borders === undefined
        ? EMPTY_BORDER_INDEX
        : this.internBorder(decoration.borders);
    const record: CellFormatRecord = { numFmtId, fillId, borderId };
    if (
      decoration.alignment !== undefined ||
      decoration.verticalAlignment !== undefined
    ) {
      record.alignment = {
        horizontal: decoration.alignment,
        vertical: decoration.verticalAlignment,
      };
    }
    const index = this.records.length;
    this.records.push(record);
    this.indexBySignature.set(signature, index);
    return index;
  }

  // Every custom format code this table assigned an id to, in id order -- one <numFmt> element each, and empty whenever nothing beyond the built-ins was ever interned.
  declarations(): readonly DeclaredNumberFormat[] {
    return this.declared;
  }

  // One numFmtId per cellXfs entry, in index order: the array index IS the value a cell's own `s` attribute carries. Kept for callers that consumed the original numFmtId-only view; cellFormatRecords() below is the richer entry point that also carries fillId/borderId/alignment.
  cellFormats(): readonly number[] {
    return this.records.map((record) => record.numFmtId);
  }

  // The full per-index records the writer's <cellXfs> emitter consumes.
  cellFormatRecords(): readonly CellFormatRecord[] {
    return this.records;
  }

  // The <fills> section: the two reserved entries first (none at 0, gray125 at 1), then one fill per distinct background a cell actually asked for -- solid or pattern alike -- in first-intern order.
  fillDeclarations(): readonly DeclaredFill[] {
    return this.fills;
  }

  // The <borders> section: the empty reserved entry first (index 0), then one border per distinct edge set, in first-intern order.
  borderDeclarations(): readonly DeclaredBorder[] {
    return this.borders;
  }

  private declareNumberFormat(code: string): number {
    const id = FIRST_CUSTOM_NUM_FMT_ID + this.declared.length;
    this.declared.push({ id, code });
    return id;
  }

  private internFill(background: ContentCellFill): number {
    const signature = fillSignature(background);
    const existing = this.fillIndexBySignature.get(signature);
    if (existing !== undefined) {
      return existing;
    }
    let declared: DeclaredFill;
    switch (background.kind) {
      case "solid":
        declared = { kind: "solid", rgb: colorToRgbHex(background.color) };
        break;
      case "pattern": {
        if (!isXlsxPatternType(background.patternType)) {
          throw new Error(
            `ooxml.js cannot write a '${background.patternType}' cell fill: ECMA-376's own ST_PatternType vocabulary has no member for it, that pattern name belonging only to WordprocessingML's ST_Shd half of ContentCellPatternType's shared vocabulary`,
          );
        }
        declared = {
          kind: "pattern",
          patternType: background.patternType,
          ...(background.foregroundColor === undefined
            ? {}
            : { fgRgb: colorToRgbHex(background.foregroundColor) }),
          ...(background.backgroundColor === undefined
            ? {}
            : { bgRgb: colorToRgbHex(background.backgroundColor) }),
        };
        break;
      }
      default:
        // Reporting the actual kind beats an if/else's implicit "anything that isn't 'solid' must be 'pattern'", which would silently mistreat an undefined kind as a real pattern lookup instead of naming the actual cause.
        throw new Error(
          `ooxml.js cannot write a cell fill with kind '${unrecognizedFillKind(background)}': ContentCellFillSchema's discriminated union only defines 'solid' and 'pattern'`,
        );
    }
    const index = this.fills.length;
    this.fills.push(declared);
    this.fillIndexBySignature.set(signature, index);
    return index;
  }

  private internBorder(borders: ContentCellBorders): number {
    const edges: DeclaredBorder["edges"] = {};
    let signature = "";
    for (const edge of ["left", "right", "top", "bottom"] as const) {
      const border = borders[edge];
      if (border !== undefined) {
        const style = borderToXlsxStyle(border);
        const rgb = colorToRgbHex(border.color);
        edges[edge] = { style, rgb };
        signature += `|${edge}:${style}:${rgb}`;
      }
    }
    const existing = this.borderIndexBySignature.get(signature);
    if (existing !== undefined) {
      return existing;
    }
    const index = this.borders.length;
    this.borders.push({ edges });
    this.borderIndexBySignature.set(signature, index);
    return index;
  }
}

// Exposed for build.ts so the writer emits the same reserved indices this table seeds: the none/gray125 fills precede any real solid fill, and the empty border precedes any real border. Each is the array index a cellFormatRecord's fillId/borderId refers to.
export const RESERVED_FILL_INDICES = {
  none: NONE_FILL_INDEX,
  gray125: GRAY125_FILL_INDEX,
  firstReal: FIRST_REAL_FILL_INDEX,
} as const;
export const RESERVED_BORDER_INDICES = {
  empty: EMPTY_BORDER_INDEX,
  firstReal: FIRST_REAL_BORDER_INDEX,
} as const;
