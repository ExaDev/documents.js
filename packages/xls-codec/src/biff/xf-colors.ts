import type {
  BorderWeight,
  Color,
  ContentBorder,
  ContentStrokeStyle,
} from "document-schema.js";
import {
  BORDER_WIDTH_PT,
  borderWeightForWidthPt,
  colorToRgbHex,
  dashedBorderWeightForWidthPt,
} from "document-schema.js";

import type { BlockCursor } from "./cursor";

// The colour and border/fill vocabulary an XF record's trailing CellXF/StyleXF payload carries ([MS-XLS] 2.4.353), and the workbook-wide Palette record ([MS-XLS] 2.4.188) its icv fields resolve through. This is the one place the bit layout of that trailing payload's border/fill words is packed or unpacked -- workbook/globals.ts's readCellFormat unpacks it on read, biff/xf-writer.ts's writeCellXfRecord packs it on write, and both call into the same functions here rather than each carrying an independent copy of the layout.
//
// Deliberately out of scope: alignment (the payload's own leading word) and per-cell fonts. See xls-codec's README, "Cell decoration" -- this package has never modelled a per-cell font, matching ooxml.js's own xlsx reader, and alignment is a separate, unclaimed gap this module does not touch.

// --- FillPattern ([MS-XLS] "FillPattern" enumeration) ---

/** FLSNULL: no fill pattern -- the cell's fill colour fields carry no meaning. */
export const FILL_PATTERN_NONE = 0x00;
/** FLSSOLID: a solid fill, the only pattern this package maps onto ContentSheetCell.background -- "If this value is 1 ... then only icvFore is rendered" ([MS-XLS] CellXF). Every other pattern (50%/75%/25% gray, the stripe and crosshatch families, ...) is a real information-loss case this reader does not approximate: see resolveFillBackground below. */
export const FILL_PATTERN_SOLID = 0x01;

// --- BorderStyle ([MS-XLS] "BorderStyle" enumeration) ---

export const BORDER_STYLE_NONE = 0x0;
export const BORDER_STYLE_THIN = 0x1;
export const BORDER_STYLE_MEDIUM = 0x2;
export const BORDER_STYLE_DASHED = 0x3;
export const BORDER_STYLE_DOTTED = 0x4;
export const BORDER_STYLE_THICK = 0x5;
export const BORDER_STYLE_DOUBLE = 0x6;
export const BORDER_STYLE_HAIR = 0x7;
export const BORDER_STYLE_MEDIUM_DASHED = 0x8;
export const BORDER_STYLE_DASHDOT = 0x9;
export const BORDER_STYLE_MEDIUM_DASHDOT = 0xa;
export const BORDER_STYLE_DASHDOTDOT = 0xb;
export const BORDER_STYLE_MEDIUM_DASHDOTDOT = 0xc;
export const BORDER_STYLE_SLANT_DASHDOT = 0xd;

// --- Icv ([MS-XLS] "Icv" enumeration): the colour table every icvFore/icvBack/icvLeft/icvRight/icvTop/icvBottom field indexes into ---

/** IcvXF's two "Automatic" special values: the foreground/background pair a real Excel-written XF with no explicit fill carries, and what this package's own writer emits for an undecorated cell. */
export const ICV_AUTOMATIC_FOREGROUND = 0x40;
export const ICV_AUTOMATIC_BACKGROUND = 0x41;

const RGB_BYTE_MAX = 0xff;

function rgb255(r: number, g: number, b: number): Color {
  return { r: r / RGB_BYTE_MAX, g: g / RGB_BYTE_MAX, b: b / RGB_BYTE_MAX };
}

/** Icv values 0x00-0x07: the eight fixed built-in colour constants every BIFF8 reader recognises regardless of a Palette record. This package's own writer never emits one of these (IcvXF's own field documentation: "This value SHOULD NOT be ... less than or equal to 0x07" -- the default-palette table below duplicates all eight at icv 8-15, which is what this writer uses instead), but a real third-party file may still carry one, so the read side resolves them. */
const FIXED_COLOR_TABLE: readonly Color[] = [
  rgb255(0, 0, 0), // 0x00 Black
  rgb255(255, 255, 255), // 0x01 White
  rgb255(255, 0, 0), // 0x02 Red
  rgb255(0, 255, 0), // 0x03 Green
  rgb255(0, 0, 255), // 0x04 Blue
  rgb255(255, 255, 0), // 0x05 Yellow
  rgb255(255, 0, 255), // 0x06 Magenta
  rgb255(0, 255, 255), // 0x07 Cyan
];

/** icv 8-63's own base offset: icv 8 is rgColor[0] of a Palette record (or the default table's own entry 0) -- [MS-XLS] "Icv"'s own colour-table layout. */
export const PALETTE_BASE_ICV = 0x08;
/** A Palette record's own fixed entry count ([MS-XLS] 2.4.188: "The value MUST be 56"). */
export const PALETTE_ENTRY_COUNT = 56;

/** The 56-entry default colour table icv 8-63 resolve through when no Palette record is present ([MS-XLS] "Icv"'s own default-red/green/blue columns), in icv order (index 0 = icv 8). Entries 0-7 duplicate the eight fixed colours above at their own icv+8 position -- the reason this package's writer allocates a fixed colour there rather than at icv 0-7 directly. */
const DEFAULT_PALETTE_TABLE: readonly Color[] = [
  rgb255(0, 0, 0),
  rgb255(255, 255, 255),
  rgb255(255, 0, 0),
  rgb255(0, 255, 0),
  rgb255(0, 0, 255),
  rgb255(255, 255, 0),
  rgb255(255, 0, 255),
  rgb255(0, 255, 255),
  rgb255(128, 0, 0),
  rgb255(0, 128, 0),
  rgb255(0, 0, 128),
  rgb255(128, 128, 0),
  rgb255(128, 0, 128),
  rgb255(0, 128, 128),
  rgb255(192, 192, 192),
  rgb255(128, 128, 128),
  rgb255(153, 153, 255),
  rgb255(153, 51, 102),
  rgb255(255, 255, 204),
  rgb255(204, 255, 255),
  rgb255(102, 0, 102),
  rgb255(255, 128, 128),
  rgb255(0, 102, 204),
  rgb255(204, 204, 255),
  rgb255(0, 0, 128),
  rgb255(255, 0, 255),
  rgb255(255, 255, 0),
  rgb255(0, 255, 255),
  rgb255(128, 0, 128),
  rgb255(128, 0, 0),
  rgb255(0, 128, 128),
  rgb255(0, 0, 255),
  rgb255(0, 204, 255),
  rgb255(204, 255, 255),
  rgb255(204, 255, 204),
  rgb255(255, 255, 153),
  rgb255(153, 204, 255),
  rgb255(255, 153, 204),
  rgb255(204, 153, 255),
  rgb255(255, 204, 153),
  rgb255(51, 102, 255),
  rgb255(51, 204, 204),
  rgb255(153, 204, 0),
  rgb255(255, 204, 0),
  rgb255(255, 153, 0),
  rgb255(255, 102, 0),
  rgb255(102, 102, 153),
  rgb255(150, 150, 150),
  rgb255(0, 51, 102),
  rgb255(51, 153, 102),
  rgb255(0, 51, 0),
  rgb255(51, 51, 0),
  rgb255(153, 51, 0),
  rgb255(153, 51, 102),
  rgb255(51, 51, 153),
  rgb255(51, 51, 51),
];

/** The reverse of DEFAULT_PALETTE_TABLE: a decoration colour's own hex string to the icv (8-63) it resolves to with NO Palette record present. write.ts's own colour-interning pass consults this to decide whether a workbook needs a real Palette record at all, or whether every distinct decoration colour it uses already has a home in the fixed default table. */
export const DEFAULT_PALETTE_HEX_TO_ICV: ReadonlyMap<string, number> = new Map(
  DEFAULT_PALETTE_TABLE.map((color, index) => [
    colorToRgbHex(color),
    PALETTE_BASE_ICV + index,
  ]),
);

/**
 * Resolves an icv colour-table index to a real colour, or undefined when the index names something this package cannot express as a fixed RGB value: 0x40/0x41 ("Automatic", a display-setting colour with no fixed literal), 0x48/0x4D-0x51/0x7FFF (chart/tooltip display colours, out of scope for a cell's own fill/border), or anything else outside the documented ranges.
 *
 * `palette`, when given, is the workbook's own Palette record contents (56 entries, icv 8 first); when undefined, icv 8-63 resolve through the fixed default table instead -- [MS-XLS] "Icv"'s own documented fallback for a file carrying no Palette record.
 */
export function resolveIcvColor(
  icv: number,
  palette: readonly Color[] | undefined,
): Color | undefined {
  if (icv >= 0 && icv < FIXED_COLOR_TABLE.length) {
    return FIXED_COLOR_TABLE[icv];
  }
  if (icv >= PALETTE_BASE_ICV && icv < PALETTE_BASE_ICV + PALETTE_ENTRY_COUNT) {
    const index = icv - PALETTE_BASE_ICV;
    return palette === undefined
      ? DEFAULT_PALETTE_TABLE[index]
      : palette[index];
  }
  return undefined;
}

// --- Border style <-> ContentBorder mapping, one table shared by both directions ---

// BIFF8's BorderStyle tokens name the same four weights xlsx's own CT_BorderStyle tokens do, at the same point widths, bucketed back from a widthPt the same way. That vocabulary is not this package's to own: it lives once in document-schema.js (BORDER_WIDTH_PT, borderWeightForWidthPt, dashedBorderWeightForWidthPt, imported above) and is imported by both this package and ooxml.js's typed/xlsx/styles.ts, so neither can drift from the other. What is BIFF8-specific -- which numeric token names a medium dashed stroke -- stays here, in BIFF_BORDER_STYLE and borderStyleTokenFor below.

interface BorderStyleMapping {
  readonly weight: BorderWeight;
  readonly pattern: ContentStrokeStyle;
}

/** Every BorderStyle token this reader resolves to a (weight, pattern) pair -- BORDER_STYLE_NONE has no entry, since "no border" is handled by the caller before consulting this table. The dash-family tokens (dashDot/dashDotDot and their medium/slant variants) collapse to 'dashed', the closest ContentStrokeStyle member, exactly as ooxml.js's own XLSX_BORDER_STYLE table does for the equivalent xlsx tokens. */
const BIFF_BORDER_STYLE: Readonly<Record<number, BorderStyleMapping>> = {
  [BORDER_STYLE_THIN]: { weight: "thin", pattern: "solid" },
  [BORDER_STYLE_MEDIUM]: { weight: "medium", pattern: "solid" },
  [BORDER_STYLE_DASHED]: { weight: "thin", pattern: "dashed" },
  [BORDER_STYLE_DOTTED]: { weight: "thin", pattern: "dotted" },
  [BORDER_STYLE_THICK]: { weight: "thick", pattern: "solid" },
  [BORDER_STYLE_DOUBLE]: { weight: "thin", pattern: "double" },
  [BORDER_STYLE_HAIR]: { weight: "hair", pattern: "solid" },
  [BORDER_STYLE_MEDIUM_DASHED]: { weight: "medium", pattern: "dashed" },
  [BORDER_STYLE_DASHDOT]: { weight: "thin", pattern: "dashed" },
  [BORDER_STYLE_MEDIUM_DASHDOT]: { weight: "medium", pattern: "dashed" },
  [BORDER_STYLE_DASHDOTDOT]: { weight: "thin", pattern: "dashed" },
  [BORDER_STYLE_MEDIUM_DASHDOTDOT]: { weight: "medium", pattern: "dashed" },
  [BORDER_STYLE_SLANT_DASHDOT]: { weight: "medium", pattern: "dashed" },
};

/** One border edge's own raw fields, as the CellXF/StyleXF trailing payload packs them: a BorderStyle line-style token and a 7-bit icv colour index. */
export interface XfBorderEdge {
  readonly style: number;
  readonly icv: number;
}

/** Resolves one border edge to a ContentBorder, or undefined when the edge carries no border (style is BORDER_STYLE_NONE), names a reserved/unrecognised style token, or its colour does not resolve to a fixed RGB value (an "Automatic" or display-setting icv, which [MS-XLS] documents as illegal for a well-formed border but a malformed file could still carry). */
export function resolveBorderEdge(
  edge: XfBorderEdge,
  palette: readonly Color[] | undefined,
): ContentBorder | undefined {
  if (edge.style === BORDER_STYLE_NONE) {
    return undefined;
  }
  const resolved = BIFF_BORDER_STYLE[edge.style];
  if (resolved === undefined) {
    return undefined;
  }
  const color = resolveIcvColor(edge.icv, palette);
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

/** The BorderStyle token each named weight's own plain solid stroke is spelled with. */
const SOLID_BORDER_STYLE: Readonly<Record<BorderWeight, number>> = {
  hair: BORDER_STYLE_HAIR,
  thin: BORDER_STYLE_THIN,
  medium: BORDER_STYLE_MEDIUM,
  thick: BORDER_STYLE_THICK,
};

/** The inverse of resolveBorderEdge's style resolution: picks the BorderStyle token carrying a ContentBorder's own pattern at the closest named weight, bucketing a solid/dashed border's widthPt back to a weight through document-schema.js's own shared quantisation -- the same one resolveBorderEdge's widths came out of, and the same one ooxml.js's borderToXlsxStyle buckets xlsx's string tokens through. */
export function borderStyleTokenFor(border: ContentBorder): number {
  switch (border.style) {
    case "double":
      return BORDER_STYLE_DOUBLE;
    case "dotted":
      return BORDER_STYLE_DOTTED;
    case "dashed":
      return dashedBorderWeightForWidthPt(border.widthPt) === "medium"
        ? BORDER_STYLE_MEDIUM_DASHED
        : BORDER_STYLE_DASHED;
    case "solid":
    case undefined:
      return SOLID_BORDER_STYLE[borderWeightForWidthPt(border.widthPt)];
  }
}

/** A solid fill's own foreground colour resolved to a real background, or undefined for every other FillPattern value -- FLSNULL (no fill at all) and every pattern beyond solid (50%/75%/25% gray, the stripe and crosshatch family) alike. A non-solid pattern is a real information-loss case rather than an oversight: ContentSheetCell.background models one flat colour, and approximating a striped or crosshatched fill as its foreground colour alone would misrepresent what the cell actually shows -- see xls-codec's README for this package's own stated judgment call. */
export function resolveFillBackground(
  fillPattern: number,
  foregroundIcv: number,
  palette: readonly Color[] | undefined,
): Color | undefined {
  if (fillPattern !== FILL_PATTERN_SOLID) {
    return undefined;
  }
  return resolveIcvColor(foregroundIcv, palette);
}

// --- The CellXF/StyleXF trailing payload's border/fill words, packed and unpacked in one place ---

/** Every decoration field the trailing payload's word2/word3/word4 carry ([MS-XLS] 2.4.353's own CellXF/StyleXF "Data" field), read or write side alike: which fill pattern (if any) and its foreground colour, and each of the four sides' own border style plus colour. Diagonal borders (dgDiag/grbitDiag/icvDiag) are out of this package's scope -- ContentCellBordersSchema has no diagonal member -- and are always read as absent / always written as none. */
export interface XfDecorationFields {
  readonly fillPattern: number;
  readonly fillForegroundIcv: number;
  readonly left: XfBorderEdge;
  readonly right: XfBorderEdge;
  readonly top: XfBorderEdge;
  readonly bottom: XfBorderEdge;
}

const UNDECORATED_EDGE: XfBorderEdge = { style: BORDER_STYLE_NONE, icv: 0 };

/** The fields a genuinely undecorated cell XF carries -- no fill, no borders -- matching exactly what xf-writer.ts wrote before this module existed (icvFore/icvBack at the "Automatic" special values, fls/dg all 0), so packXfDecorationWords() with no argument reproduces the identical bytes. */
export const UNDECORATED_XF_FIELDS: XfDecorationFields = {
  fillPattern: FILL_PATTERN_NONE,
  fillForegroundIcv: ICV_AUTOMATIC_FOREGROUND,
  left: UNDECORATED_EDGE,
  right: UNDECORATED_EDGE,
  top: UNDECORATED_EDGE,
  bottom: UNDECORATED_EDGE,
};

/** Unpacks the three raw words a CellXF/StyleXF trailing payload's border/fill fields live in ([MS-XLS] 2.4.353's own field table, cited in full in xf-writer.ts's packXfDecorationWords below) into XfDecorationFields. word2 is the 32-bit border word (dgLeft/dgRight/dgTop/dgBottom/icvLeft/icvRight/grbitDiag), word3 the 32-bit fill-pattern word (icvTop/icvBottom/icvDiag/dgDiag/fHasXFExt/fls), word4 the 16-bit fill-colour word (icvFore/icvBack/...). */
export function unpackXfDecoration(
  word2: number,
  word3: number,
  word4: number,
): XfDecorationFields {
  const dgLeft = word2 & 0xf;
  const dgRight = (word2 >>> 4) & 0xf;
  const dgTop = (word2 >>> 8) & 0xf;
  const dgBottom = (word2 >>> 12) & 0xf;
  const icvLeft = (word2 >>> 16) & 0x7f;
  const icvRight = (word2 >>> 23) & 0x7f;
  const icvTop = word3 & 0x7f;
  const icvBottom = (word3 >>> 7) & 0x7f;
  const fls = (word3 >>> 26) & 0x3f;
  const icvFore = word4 & 0x7f;
  return {
    fillPattern: fls,
    fillForegroundIcv: icvFore,
    left: { style: dgLeft, icv: icvLeft },
    right: { style: dgRight, icv: icvRight },
    top: { style: dgTop, icv: icvTop },
    bottom: { style: dgBottom, icv: icvBottom },
  };
}

/**
 * Packs XfDecorationFields back into the three raw words unpackXfDecoration reads -- the write-side mirror, and (with no argument) the exact bytes a genuinely undecorated XF always carried before this module existed: word2/word3 all zero (no borders, no fill pattern), word4 at the "Automatic" foreground/background pair. Diagonal fields (grbitDiag, dgDiag, icvDiag, fHasXFExt/reserved2) are always written as 0 -- this package's writer never emits a diagonal border.
 *
 * [MS-XLS] 2.4.353's own CellXF field table, the layout every bit position below is cited to: word2 = dgLeft(4) dgRight(4) dgTop(4) dgBottom(4) icvLeft(7) icvRight(7) grbitDiag(2); word3 = icvTop(7) icvBottom(7) icvDiag(7) dgDiag(4) fHasXFExt(1) fls(6); word4 = icvFore(7) icvBack(7) fsxButton(1) reserved3(1). https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/671c8577-901f-4215-9ebf-6f5890e5896d
 */
export function packXfDecorationWords(
  decoration: XfDecorationFields = UNDECORATED_XF_FIELDS,
): { word2: number; word3: number; word4: number } {
  const { left, right, top, bottom } = decoration;
  const grbitDiag = 0;
  const word2 =
    (left.style & 0xf) |
    ((right.style & 0xf) << 4) |
    ((top.style & 0xf) << 8) |
    ((bottom.style & 0xf) << 12) |
    ((left.icv & 0x7f) << 16) |
    ((right.icv & 0x7f) << 23) |
    ((grbitDiag & 0x3) << 30);

  const icvDiag = 0;
  const dgDiag = 0;
  const fHasXfExt = 0;
  const word3 =
    (top.icv & 0x7f) |
    ((bottom.icv & 0x7f) << 7) |
    ((icvDiag & 0x7f) << 14) |
    ((dgDiag & 0xf) << 21) |
    ((fHasXfExt & 0x1) << 25) |
    ((decoration.fillPattern & 0x3f) << 26);

  // icvFore is meaningless for anything but a solid fill ("If this value is 1, then only icvFore is rendered") -- forcing it to the Automatic default whenever fillPattern isn't solid keeps a border-only decoration's fill word byte-identical to a genuinely undecorated one, matching what a real Excel-written cell with borders but no fill also carries.
  const icvFore =
    decoration.fillPattern === FILL_PATTERN_SOLID
      ? decoration.fillForegroundIcv
      : ICV_AUTOMATIC_FOREGROUND;

  const word4 = (icvFore & 0x7f) | ((ICV_AUTOMATIC_BACKGROUND & 0x7f) << 7);

  return { word2, word3, word4 };
}

// --- LongRGB ([MS-XLS], a Palette record's own rgColor entry shape) ---

/** LongRGB: red, green, blue, then a reserved byte that MUST be 0 -- one entry of a Palette record's rgColor array, or of the fixed-length buffer this package's own writer emits. */
export function readLongRgbColor(cursor: BlockCursor): Color {
  const r = cursor.u8();
  const g = cursor.u8();
  const b = cursor.u8();
  cursor.u8(); // reserved, MUST be 0 and MUST be ignored
  return rgb255(r, g, b);
}

/** The inverse of readLongRgbColor: a colour's own red/green/blue/reserved bytes, rounded to the nearest byte (the same rounding colorToRgbHex applies) -- exact for any colour this package itself constructed via rgbHexToColor, which is what write.ts's own palette-colour interning does. */
export function longRgbBytesOf(
  color: Color,
): readonly [number, number, number, number] {
  return [
    Math.round(color.r * RGB_BYTE_MAX),
    Math.round(color.g * RGB_BYTE_MAX),
    Math.round(color.b * RGB_BYTE_MAX),
    0,
  ];
}
