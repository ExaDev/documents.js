import type {
  Color,
  ContentBorder,
  ContentCellBorders,
  ContentStrokeStyle,
} from "document-schema.js";
import { readUint16LE, readUint8 } from "../bytes";
import {
  autoColorRefBytes,
  colorRefBytes,
  icoColor,
  nearestIco,
  readColorRef,
} from "../color";
import { DocFormatError } from "../errors";

// A table cell's own border and background-shading encodings, read and written in one place -- the role xls-codec's biff/xf-colors.ts plays for BIFF8's own CellXF payload, and for the same reason: table/tap.ts unpacks these on the read side and table/tap-write.ts packs them on the write side, so a bit layout either of them got wrong on its own would round-trip through this package undetected while disagreeing with every other [MS-DOC] implementation.
//
// [MS-DOC] states a cell's borders in two places at once, and this module handles both because a real, independent implementation writes both. TC80 ([MS-DOC] 2.9.341) carries four Brc80MayBeNil fields ([MS-DOC] 2.9.18, a Brc80 -- 2.9.17) whose colour is an Ico palette index, so a border colour outside that fixed 17-entry palette cannot be stated there at all; sprmTSetBrc (0xD62F, a TableBrcOperand -- [MS-DOC] 2.9.290) states the same border for a named cell range with a full 8-byte Brc ([MS-DOC] 2.9.16) carrying an exact COLORREF. LibreOffice 26.2.5.2 writes both for every bordered cell, with the Brc80's own ico snapped to the palette and the Brc's cv exact -- confirmed by converting a hand-authored .fodt table through `soffice --headless --convert-to doc` and parsing the resulting row mark's raw grpprl with this package's own primitives: a 0.5pt solid #ff0000 top border came back as TC80.brcTop = `04 01 06 00` (Brc80: dptLineWidth 4, brcType 0x01 single, ico 0x06 red) alongside sprmTSetBrc `0b 01 02 01 ff 00 00 00 04 01 00 00` (TableBrcOperand: cells [1,2), bordersToApply 0x01 top, Brc cv = exact #ff0000). This package reads both -- sprmTSetBrc folding onto TC80's own layer, exactly as sprmTMerge/sprmTVertMerge already fold onto sprmTDefTable's -- and writes both, emitting the sprmTSetBrc precision layer only where the palette genuinely cannot state the colour (see borderNeedsExactColor).
//
// Shading has no TC80 field at all. It rides its own row-level sprms carrying one Shd ([MS-DOC] 2.9.240) per cell -- cvFore, cvBack, and an Ipat pattern index ([MS-DOC] 2.9.135) -- which is why the "TC80's own ... shading fields" this package's README once described as unread never existed to read.

/** The four sides of a cell, in the order TC80 declares them ([MS-DOC] 2.9.341: brcTop, brcLeft, brcBottom, brcRight). Used as the iteration order for both directions, so a side can never be read from one offset and written to another. */
export const CELL_BORDER_SIDES = ["top", "left", "bottom", "right"] as const;
export type CellBorderSide = (typeof CELL_BORDER_SIDES)[number];

/** TableBrcOperand.bordersToApply, [MS-DOC] 2.9.290: which edges one operand formats, as the bitwise OR of any subset. Only the four rectangular sides are listed -- 0x10/0x20 are the two diagonals, which ContentCellBorders has no member for and this package neither reads nor writes. */
export const BORDERS_TO_APPLY: Readonly<Record<CellBorderSide, number>> = {
  top: 0x01,
  left: 0x02,
  bottom: 0x04,
  right: 0x08,
};

/** Brc80's own fixed size, [MS-DOC] 2.9.17: dptLineWidth (1) + brcType (1) + ico (1) + dptSpace/fShadow/fFrame/reserved (1). */
export const BRC80_SIZE = 4;
/** Brc's own fixed size, [MS-DOC] 2.9.16: cv (4) + dptLineWidth (1) + brcType (1) + dptSpace/fShadow/fFrame/fReserved (2). */
export const BRC_SIZE = 8;
/** Shd's own fixed size, [MS-DOC] 2.9.240: cvFore (4) + cvBack (4) + ipat (2). */
export const SHD_SIZE = 10;
/** Shd80's own fixed size, [MS-DOC] 2.9.241: one 16-bit word packing icoFore (5 bits), icoBack (5 bits) and ipat (6 bits). */
export const SHD80_SIZE = 2;

/** BrcType 0x00, [MS-DOC] 2.9.19: "No border." Distinct from the Brc80MayBeNil/BrcMayBeNil all-bits-set sentinel, and the spelling a real producer (LibreOffice) uses for an undecorated cell -- both mean the same thing and both are read as no border. */
const BRC_TYPE_NONE = 0x00;
const BRC_TYPE_SINGLE = 0x01;
const BRC_TYPE_DOUBLE = 0x03;
const BRC_TYPE_DOTTED = 0x06;
const BRC_TYPE_DASHED = 0x07;

/**
 * Every BrcType [MS-DOC] 2.9.19 defines for a cell border (0x00 through 0x1B), mapped onto the four members ContentStrokeStyle has. Values 0x02 and 0x04 are absent from the published enumeration entirely and so have no entry here; 0x00 is handled by the caller before this table is consulted.
 *
 * Three families collapse, each stated rather than silently folded -- the same deliberate narrowing xls-codec's own BIFF_BORDER_STYLE makes for BIFF8's dash tokens. The dash family (dotDash 0x08, dotDotDash 0x09, dashSmallGap 0x16, dashDotStroked 0x17) collapses to 'dashed', since ContentStrokeStyle names one dashed pattern rather than a vocabulary of them. Every genuinely multi-line border collapses to 'double': the triple line (0x0A), the nine thinThick/thickThin gap variants (0x0B-0x13), the double wave (0x15), the two three-dimensional borders (0x18/0x19), and outset/inset (0x1A/0x1B, which Brc80 forbids but Brc permits). And the single wavy line (0x14) collapses to 'solid', being one continuous stroke.
 *
 * Values from 0x40 to 0xE3 are the art/image page borders, which [MS-DOC] 2.9.19 permits only "if they describe a page border" -- never a cell border -- so they have no entry and read as no border at all rather than as an invented approximation of a picture. 0xFF ("This MUST be ignored") is likewise absent.
 */
const BRC_TYPE_STYLE: Readonly<Record<number, ContentStrokeStyle>> = {
  [BRC_TYPE_SINGLE]: "solid",
  [BRC_TYPE_DOUBLE]: "double",
  0x05: "solid", // A thin single solid line.
  [BRC_TYPE_DOTTED]: "dotted",
  [BRC_TYPE_DASHED]: "dashed",
  0x08: "dashed", // dotDash
  0x09: "dashed", // dotDotDash
  0x0a: "double", // triple
  0x0b: "double", // thinThickSmallGap
  0x0c: "double", // thickThinSmallGap
  0x0d: "double", // thinThickThinSmallGap
  0x0e: "double", // thinThickMediumGap
  0x0f: "double", // thickThinMediumGap
  0x10: "double", // thinThickThinMediumGap
  0x11: "double", // thinThickLargeGap
  0x12: "double", // thickThinLargeGap
  0x13: "double", // thinThickThinLargeGap
  0x14: "solid", // wave
  0x15: "double", // doubleWave
  0x16: "dashed", // dashSmallGap
  0x17: "dashed", // dashDotStroked
  0x18: "double", // threeDEmboss
  0x19: "double", // threeDEngrave
  0x1a: "double", // outset
  0x1b: "double", // inset
};

/** The inverse of BRC_TYPE_STYLE: the one BrcType each ContentStrokeStyle member is written as. Every collapsed family above writes back as its own family's plainest member, since that is the only one the collapsed value can honestly claim to be. */
const STYLE_BRC_TYPE: Readonly<Record<ContentStrokeStyle, number>> = {
  solid: BRC_TYPE_SINGLE,
  dashed: BRC_TYPE_DASHED,
  dotted: BRC_TYPE_DOTTED,
  double: BRC_TYPE_DOUBLE,
};

/** dptLineWidth's own unit, [MS-DOC] 2.9.16/2.9.17: "the width of the border in 1/8-point increments" for every brcType below 0x40, which is every type a cell border can carry. */
const EIGHTHS_PER_POINT = 8;
/** "Values of less than 2 are considered to be equivalent to 2" -- the specification's own floor, applied on read so a border stating 0 or 1 resolves to the width it actually renders at rather than to a widthPt ContentBorderSchema would reject for not being positive. */
const MIN_DPT_LINE_WIDTH = 2;
/** dptLineWidth is a single byte, so 255 eighths (31.875pt) is the widest border the format can state at all. */
const MAX_DPT_LINE_WIDTH = 0xff;

/** The colour a border with no colour of its own resolves to. [MS-DOC]'s automatic colour (Ico 0x00, or a COLORREF with fAuto set) "designates the default color for the application" and names no components, but ContentBorder.color is required, so a border stating one has to resolve to something. Black is what an automatic border renders as against a default background, and resolving to it keeps the border itself -- which genuinely exists and genuinely renders -- rather than dropping the border outright to avoid stating a colour for it. */
const AUTOMATIC_BORDER_COLOR: Color = { r: 0, g: 0, b: 0 };

function borderFrom(
  dptLineWidth: number,
  brcType: number,
  color: Color | undefined,
): ContentBorder | undefined {
  const style = BRC_TYPE_STYLE[brcType];
  if (style === undefined) return undefined;
  const border: ContentBorder = {
    color: color ?? AUTOMATIC_BORDER_COLOR,
    widthPt: Math.max(dptLineWidth, MIN_DPT_LINE_WIDTH) / EIGHTHS_PER_POINT,
  };
  // ContentBorderSchema's own convention: an absent style means 'solid', so stating it explicitly would be noise on the overwhelmingly common case.
  if (style !== "solid") border.style = style;
  return border;
}

/** Whether all `length` bytes from `offset` are 0xFF -- the all-bits-set form both nil-border spellings are defined in terms of. */
function allBitsSet(
  bytes: Uint8Array,
  offset: number,
  length: number,
): boolean {
  for (let index = 0; index < length; index += 1) {
    if (readUint8(bytes, offset + index) !== 0xff) return false;
  }
  return true;
}

/** One TC80 border field: a Brc80MayBeNil ([MS-DOC] 2.9.18) -- a Brc80 whose all-bits-set value "specifies that the region in question has no border". Returns undefined for that sentinel, for brcType 0x00 ("No border", the spelling LibreOffice writes instead), and for any brcType outside the cell-border range BRC_TYPE_STYLE covers. */
export function readBrc80(
  bytes: Uint8Array,
  offset: number,
): ContentBorder | undefined {
  if (allBitsSet(bytes, offset, BRC80_SIZE)) return undefined;
  const brcType = readUint8(bytes, offset + 1);
  if (brcType === BRC_TYPE_NONE) return undefined;
  return borderFrom(
    readUint8(bytes, offset),
    brcType,
    icoColor(readUint8(bytes, offset + 2)),
  );
}

/** The eight bytes of one TableBrcOperand.brc field: a BrcMayBeNil ([MS-DOC] 2.9.15) -- "If the last four bytes are 0xFFFFFFFF, the BrcMayBeNil is a NilBrc that specifies that the table cells in question have no border", otherwise a Brc ([MS-DOC] 2.9.16) whose own cv states the colour exactly. */
export function readBrc(
  bytes: Uint8Array,
  offset: number,
): ContentBorder | undefined {
  if (allBitsSet(bytes, offset + 4, BRC_SIZE - 4)) return undefined;
  const brcType = readUint8(bytes, offset + 5);
  if (brcType === BRC_TYPE_NONE) return undefined;
  return borderFrom(
    readUint8(bytes, offset + 4),
    brcType,
    readColorRef(bytes, offset),
  );
}

/** Brc80MayBeNil's own no-border value, [MS-DOC] 2.9.18: "When all bits are set (0xFFFFFFFF when interpreted as a 4-byte unsigned integer), this structure specifies that the region in question has no border." */
const NIL_BRC80: readonly number[] = [0xff, 0xff, 0xff, 0xff];

/** dptLineWidth for a border of `widthPt`, in the 1/8-point increments [MS-DOC] states it in. Refuses a width the single-byte field cannot hold rather than silently clamping it to a thinner border than the caller asked for, matching how every other out-of-range operand in this writer is handled. */
function dptLineWidthFor(widthPt: number): number {
  const eighths = Math.round(widthPt * EIGHTHS_PER_POINT);
  if (eighths < MIN_DPT_LINE_WIDTH || eighths > MAX_DPT_LINE_WIDTH) {
    throw new DocFormatError(
      `a table cell border is ${widthPt}pt, outside the ${MIN_DPT_LINE_WIDTH / EIGHTHS_PER_POINT}..${MAX_DPT_LINE_WIDTH / EIGHTHS_PER_POINT}pt range [MS-DOC]'s own single-byte dptLineWidth can state in 1/8-point increments`,
    );
  }
  return eighths;
}

/** One TC80 border field's own four bytes: the Brc80MayBeNil no-border sentinel for an absent border, otherwise a real Brc80 whose colour is the nearest Ico the fixed palette offers (see color.ts's nearestIco, and borderNeedsExactColor for how the exact colour still reaches the file). dptSpace, fShadow and fFrame are always zero -- ContentBorder models none of the three, so writing anything else would be inventing a fact the input never stated. */
export function writeBrc80(border: ContentBorder | undefined): number[] {
  if (border === undefined) return [...NIL_BRC80];
  return [
    dptLineWidthFor(border.widthPt),
    STYLE_BRC_TYPE[border.style ?? "solid"],
    nearestIco(border.color),
    0x00,
  ];
}

/** One TableBrcOperand.brc field's own eight bytes: a real Brc carrying the border's colour exactly, as a COLORREF rather than a palette index. Only ever called for a border that exists, since a TableBrcOperand naming no sides is never emitted at all. */
export function writeBrc(border: ContentBorder): number[] {
  return [
    ...colorRefBytes(border.color),
    dptLineWidthFor(border.widthPt),
    STYLE_BRC_TYPE[border.style ?? "solid"],
    0x00,
    0x00,
  ];
}

/** Whether this border's colour survives the Ico palette Brc80 is limited to. When it does, TC80's own Brc80 already states the border exactly and the sprmTSetBrc precision layer would be pure duplication; when it does not, that layer is the only place the real colour can be stated. Compared on the written byte values rather than the floating-point components, so a colour that round-trips through colorRefBytes to the identical palette entry counts as exact. */
export function borderNeedsExactColor(border: ContentBorder): boolean {
  const palette = icoColor(nearestIco(border.color));
  if (palette === undefined) return true;
  const wanted = colorRefBytes(border.color);
  const approximated = colorRefBytes(palette);
  return (
    wanted[0] !== approximated[0] ||
    wanted[1] !== approximated[1] ||
    wanted[2] !== approximated[2]
  );
}

/** ipatAuto, [MS-DOC] 2.9.135: "Clear, ST_Shd: clear" -- the pattern under which a cell simply shows its own cvBack, which is how both Word and LibreOffice spell a flat background colour, and the only pattern this package writes. */
const IPAT_AUTO = 0x0000;
/** ipatSolid, [MS-DOC] 2.9.135: "Solid ST_Shd: solid" -- the cell is filled entirely with cvFore. */
const IPAT_SOLID = 0x0001;

/**
 * One Shd ([MS-DOC] 2.9.240) as a flat background colour, or undefined where it states none.
 *
 * Only the two patterns that genuinely produce a flat fill resolve: ipatAuto, under which the cell shows cvBack (ECMA-376's own `clear` shading with a fill colour, which is what a real producer writes for a plain cell background), and ipatSolid, under which it shows cvFore. Every other Ipat -- the fourteen percentage fills, the stripe and crosshatch families, and ipatNil -- is a genuine pattern that Color cannot express, and reads as no background rather than as one of its two colours: reporting a 50% grey crosshatch as its own foreground colour would misstate what the cell actually shows. This is the same deliberate judgment xls-codec makes for BIFF8's own FillPattern enumeration, for the same reason, and it costs nothing on a round trip because this package's own writer emits ipatAuto and nothing else.
 *
 * A cvAuto colour under either pattern is likewise no background: it designates the application's own default, which for a cell background is "not shaded" rather than a colour to state. ShdAuto and ShdNil -- the two special values [MS-DOC] 2.9.240 names for "no shading is applied" -- both fall out of exactly that, with no separate check: each is a pair of cvAuto colours under ipatAuto.
 */
export function readShd(bytes: Uint8Array, offset: number): Color | undefined {
  const ipat = readUint16LE(bytes, offset + 8);
  if (ipat === IPAT_AUTO) return readColorRef(bytes, offset + 4);
  if (ipat === IPAT_SOLID) return readColorRef(bytes, offset);
  return undefined;
}

/** One Shd's own ten bytes: cvFore left automatic and the background stated as cvBack under ipatAuto, which is exactly how LibreOffice 26.2.5.2 writes a cell fill (confirmed against its own `.doc` output: a #ffff00 cell came back as cvFore cvAuto, cvBack `ff ff 00 00`, ipat 0x0000). An absent background writes ShdAuto -- the all-automatic value [MS-DOC] 2.9.240 defines as "no shading is applied" -- so an undecorated cell inside a row that has decorated ones still states its own lack of shading rather than inheriting a neighbour's. */
export function writeShd(background: Color | undefined): number[] {
  return [
    ...autoColorRefBytes(),
    ...(background === undefined
      ? autoColorRefBytes()
      : colorRefBytes(background)),
    IPAT_AUTO & 0xff,
    (IPAT_AUTO >> 8) & 0xff,
  ];
}

/** Shd80Nil, [MS-DOC] 2.9.241: icoFore 0x1F, icoBack 0x1F, ipat 0x3F -- every bit set, "specifies that no shading is applied", and explicitly exempt from the Ico and Ipat bounds the fields otherwise carry. */
const SHD80_NIL = 0xffff;

/** One Shd80 ([MS-DOC] 2.9.241) as a flat background colour: the same ipatAuto/ipatSolid reading readShd applies, over the Ico palette rather than COLORREFs. This is the Word 97-era spelling of cell shading, superseded by Shd but still written -- alongside it -- by a real producer, so a file carrying only this one still reads. Never written by this package, which states shading through Shd alone. */
export function readShd80(value: number): Color | undefined {
  if (value === SHD80_NIL) return undefined;
  const icoFore = value & 0x1f;
  const icoBack = (value >> 5) & 0x1f;
  const ipat = (value >> 10) & 0x3f;
  if (ipat === IPAT_AUTO) return icoColor(icoBack);
  if (ipat === IPAT_SOLID) return icoColor(icoFore);
  return undefined;
}

/** A cell's four sides as a ContentCellBorders, or undefined when it has none -- the shape ContentTableCell.borders carries, with an absent side meaning that side has no border rather than an explicitly-null one. */
export function cellBordersFrom(
  sides: Readonly<Record<CellBorderSide, ContentBorder | undefined>>,
): ContentCellBorders | undefined {
  const borders: ContentCellBorders = {};
  let any = false;
  for (const side of CELL_BORDER_SIDES) {
    const border = sides[side];
    if (border === undefined) continue;
    borders[side] = border;
    any = true;
  }
  return any ? borders : undefined;
}
