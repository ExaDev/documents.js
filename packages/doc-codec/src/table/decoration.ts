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
  decorativeIcoColor,
  icoColor,
  nearestIco,
  readColorRef,
} from "../color";
import { DocFormatError } from "../errors";

// A table cell's own border and background-shading encodings, read and written in one place -- the role xls-codec's biff/xf-colors.ts plays for BIFF8's own CellXF payload, and for the same reason: table/tap.ts unpacks these on the read side and table/tap-write.ts packs them on the write side, so a bit layout either of them got wrong on its own would round-trip through this package undetected while disagreeing with every other [MS-DOC] implementation.
//
// [MS-DOC] states a cell's borders in two places at once, and this module handles both because a real, independent implementation writes both. TC80 ([MS-DOC] 2.9.313) carries four Brc80MayBeNil fields ([MS-DOC] 2.9.18, a Brc80 -- 2.9.17) whose colour is an Ico palette index, so a border colour outside that fixed 17-entry palette cannot be stated there at all; sprmTSetBrc (0xD62F, a TableBrcOperand -- [MS-DOC] 2.9.305) states the same border for a named cell range with a full 8-byte Brc ([MS-DOC] 2.9.16) carrying an exact COLORREF. LibreOffice 26.2.5.2 writes both for every bordered cell, with the Brc80's own ico snapped to the palette and the Brc's cv exact -- confirmed by converting a hand-authored .fodt table through `soffice --headless --convert-to doc` and parsing the resulting row mark's raw grpprl with this package's own primitives: a 0.5pt solid #ff0000 top border came back as TC80.brcTop = `04 01 06 00` (Brc80: dptLineWidth 4, brcType 0x01 single, ico 0x06 red) alongside sprmTSetBrc `0b 01 02 01 ff 00 00 00 04 01 00 00` (TableBrcOperand: cells [1,2), bordersToApply 0x01 top, Brc cv = exact #ff0000). This package reads both -- sprmTSetBrc folding onto TC80's own layer, exactly as sprmTMerge/sprmTVertMerge already fold onto sprmTDefTable's -- and writes both, emitting the sprmTSetBrc precision layer only where the palette genuinely cannot state the colour (see borderNeedsExactColor).
//
// Shading has no TC80 field at all. It rides its own row-level sprms carrying one Shd ([MS-DOC] 2.9.247) per cell -- cvFore, cvBack, and an Ipat pattern index ([MS-DOC] 2.9.121) -- which is why the "TC80's own ... shading fields" this package's README once described as unread never existed to read.

/** The four sides of a cell, in the order TC80 declares them ([MS-DOC] 2.9.313: brcTop, brcLeft, brcBottom, brcRight). Used as the iteration order for both directions, so a side can never be read from one offset and written to another. */
export const CELL_BORDER_SIDES = ["top", "left", "bottom", "right"] as const;
export type CellBorderSide = (typeof CELL_BORDER_SIDES)[number];

/** TableBrcOperand.bordersToApply, [MS-DOC] 2.9.305: which edges one operand formats, as the bitwise OR of any subset. Only the four rectangular sides are listed -- 0x10/0x20 are the two diagonals, which ContentCellBorders has no member for and this package neither reads nor writes. */
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
/** Shd's own fixed size, [MS-DOC] 2.9.247: cvFore (4) + cvBack (4) + ipat (2). */
export const SHD_SIZE = 10;
/** Shd80's own fixed size, [MS-DOC] 2.9.248: one 16-bit word packing icoFore (5 bits), icoBack (5 bits) and ipat (6 bits). */
export const SHD80_SIZE = 2;

/** BrcType 0x00, [MS-DOC] 2.9.22: "No border." Distinct from the Brc80MayBeNil/BrcMayBeNil all-bits-set sentinel, and the spelling a real producer (LibreOffice) uses for an undecorated cell -- both mean the same thing and both are read as no border. */
const BRC_TYPE_NONE = 0x00;
const BRC_TYPE_SINGLE = 0x01;
const BRC_TYPE_DOUBLE = 0x03;
const BRC_TYPE_DOTTED = 0x06;
const BRC_TYPE_DASHED = 0x07;

/**
 * Every BrcType [MS-DOC] 2.9.22 defines for a cell border (0x00 through 0x1B), mapped onto the four members ContentStrokeStyle has. Values 0x02 and 0x04 are absent from the published enumeration entirely and so have no entry here; 0x00 is handled by the caller before this table is consulted.
 *
 * Three families collapse, each stated rather than silently folded -- the same deliberate narrowing xls-codec's own BIFF_BORDER_STYLE makes for BIFF8's dash tokens. The dash family (dotDash 0x08, dotDotDash 0x09, dashSmallGap 0x16, dashDotStroked 0x17) collapses to 'dashed', since ContentStrokeStyle names one dashed pattern rather than a vocabulary of them. Every genuinely multi-line border collapses to 'double': the triple line (0x0A), the nine thinThick/thickThin gap variants (0x0B-0x13), the double wave (0x15), the two three-dimensional borders (0x18/0x19), and outset/inset (0x1A/0x1B, which Brc80 forbids but Brc permits). And the single wavy line (0x14) collapses to 'solid', being one continuous stroke.
 *
 * Values from 0x40 to 0xE3 are the art/image page borders, which [MS-DOC] 2.9.22 permits only "if they describe a page border" -- never a cell border -- so they have no entry and read as no border at all rather than as an invented approximation of a picture. 0xFF ("This MUST be ignored") is likewise absent.
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

/** For BrcType 0x03 (ECMA-376 ST_Border 'double') specifically, dptLineWidth states the width of one of the border's two lines, with the gap between them the same width again, rather than the border's own total rendered width -- neither [MS-DOC] nor [ECMA-376] says so in words, but LibreOffice's own WW8 border-width conversion (editeng/source/items/borderline.cxx: BorderWidthImpl for SvxBorderLineStyle::DOUBLE splits a total width into three equal 1/3 shares for line/gap/line on import, and ConvertBorderWidthToWord divides a total width by 3 on export) states it in code, and this package's own measurements agree with that split exactly: a dptLineWidth of 5 read from a genuine LibreOffice-authored file tripled to 15 eighths (1.875pt) is what LibreOffice's own re-export calls the identical border ~1.8pt double (the small remaining gap is LibreOffice's own twip-rounding on the way through its internal representation, not a further disagreement), and writing a 2pt double border under the pre-fix formula (dptLineWidth 16, i.e. widthPt taken as the field directly) came back from LibreOffice as 6pt double -- 16 read as a single line's width and tripled is exactly 6pt. Scoped to the literal 0x03 value rather than every brcType BRC_TYPE_STYLE collapses onto 'double': the same ConvertBorderWidthToWord gives most of the others their own explicit ratio too, not none -- fWidth/2.0 for THINTHICK_MEDIUMGAP/THICKTHIN_MEDIUMGAP/EMBOSSED/ENGRAVED (BrcTypes 0x0e/0x0f/0x18/0x19), a fixed line/gap width subtracted from the total for THINTHICK_SMALLGAP/THINTHICK_LARGEGAP/THICKTHIN_SMALLGAP/THICKTHIN_LARGEGAP (0x0b/0x11/0x0c/0x12), and that same subtraction halved afterwards for OUTSET/INSET (0x1a/0x1b) -- `std::max(1.0, (fWidth - OUTSET_line1) / 2.0)` and its INSET mirror, not a bare subtraction the way the SMALLGAP/LARGEGAP quartet's own formulas are -- known ratios this package deliberately does not apply, not unknown ones, because BRC_TYPE_STYLE has already collapsed every one of those, plus triple, the three-line thinThickThin gap variants, and doubleWave (none of which LibreOffice's own WW8 exporter writes at all, having no SvxBorderLineStyle member for them), onto ContentStrokeStyle's single 'double' member by the time a ContentBorder reaches dptLineWidthFor on write, so there is no way left to tell which family a given widthPt came from and therefore no way to choose the right one of even the formulas that are known; literal 0x03 is the one case free of that ambiguity, since it is the only BrcType every format in this family's own 'double' token (OOXML's w:val="double", ODF's fo:border-* double) and ContentStrokeStyle's own 'double' member actually mean. Reading one of the other 23 collapsed BrcTypes therefore still reports dptLineWidth's own untripled value as widthPt -- an approximation of unknown accuracy even before this correction existed -- and writing that value back re-emits it as a literal 0x03 with this multiplier applied regardless, a further, compounding approximation on an already-lossy round trip for that narrow, WW8-only decorative corner; decoration.test.ts pins this explicitly rather than leaving it a silent surprise. */
const DOUBLE_BORDER_WIDTH_MULTIPLIER = 3;

/** The lowest non-zero dptLineWidth this writer will ever store for a BRC_TYPE_DOUBLE border's own one-third-of-total field, once DOUBLE_BORDER_WIDTH_MULTIPLIER's own division has been applied -- not MIN_DPT_LINE_WIDTH's floor of 2, which belongs to a field that states a border's whole width directly. [MS-DOC]'s "values of less than 2 are considered to be equivalent to 2" is a read-side interpretation rule, not a constraint a producer's own writer has to respect when choosing what to store: LibreOffice's own WW8 export (sw/source/filter/ww8/ww8atr.cxx, TranslateBorderLine, calling editeng's ConvertBorderWidthToWord) applies two separate floors in two different units at two different stages, not one shared floor -- ConvertBorderWidthToWord's own std::max(1.0, fWidth / 3.0) floors double's one-third share to 1.0 twip while the value is still in twips; the result is then converted to eighths-of-a-point ("nWidth = ((nWidth * 8) + 10) / 20", an integer, rounding conversion), which truncates that 1-twip minimum straight down to 0; only then does the "if (0 == nWidth) nWidth = 1; // really thin line, don't omit" floor re-raise it, to 1 eighth-of-a-point (2.5 twips) -- a different, larger unit than the 1.0 twip the first floor stated. The two are analogous in pattern (each is its own never-quite-zero minimum-of-1 rule) but not identical in value, and it is the second, eighths-of-a-point floor MIN_DPT_LINE_WIDTH_DOUBLE mirrors, since that is the one that actually survives into the written BRC. Keeping the general single-line refusal at 2 (MIN_DPT_LINE_WIDTH, a genuinely different field-to-width relationship) while giving double its own floor of 1 keeps refusal for a width the format truly cannot state at all -- below roughly 0.1875pt total, where even a tripled dptLineWidth of 1 rounds down to 0 -- rather than at 0.5625pt, a threshold that only exists as an artefact of applying MIN_DPT_LINE_WIDTH's single-line floor after dividing by three and that no real producer observes: Word's own UI default border width (ooxml.js's own DEFAULT_BORDER_WIDTH_EIGHTH_POINTS, 0.5pt) would otherwise be unwritable as a double border at all. */
const MIN_DPT_LINE_WIDTH_DOUBLE = 1;

/** The colour a border with no colour of its own resolves to. [MS-DOC]'s automatic colour (Ico 0x00, or a COLORREF with fAuto set) "designates the default color for the application" and names no components, but ContentBorder.color is required, so a border stating one has to resolve to something. Black is what an automatic border renders as against a default background, and resolving to it keeps the border itself -- which genuinely exists and genuinely renders -- rather than dropping the border outright to avoid stating a colour for it. */
const AUTOMATIC_BORDER_COLOR: Color = { r: 0, g: 0, b: 0 };

function borderFrom(
  dptLineWidth: number,
  brcType: number,
  color: Color | undefined,
): ContentBorder | undefined {
  const style = BRC_TYPE_STYLE[brcType];
  if (style === undefined) return undefined;
  const lineWidthEighths = Math.max(dptLineWidth, MIN_DPT_LINE_WIDTH);
  const widthEighths =
    brcType === BRC_TYPE_DOUBLE
      ? lineWidthEighths * DOUBLE_BORDER_WIDTH_MULTIPLIER
      : lineWidthEighths;
  const border: ContentBorder = {
    color: color ?? AUTOMATIC_BORDER_COLOR,
    widthPt: widthEighths / EIGHTHS_PER_POINT,
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

/** One TC80 border field: a Brc80MayBeNil ([MS-DOC] 2.9.18) -- a Brc80 whose all-bits-set value "specifies that the region in question has no border". Returns undefined for that sentinel, for brcType 0x00 ("No border", the spelling LibreOffice writes instead), and for any brcType outside the cell-border range BRC_TYPE_STYLE covers. An ico outside the palette's own bound resolves through decorativeIcoColor to the automatic-colour fallback (borderFrom's own AUTOMATIC_BORDER_COLOR) rather than aborting the whole document read over one cosmetic byte -- see decorativeIcoColor's own note in color.ts. */
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
    decorativeIcoColor(readUint8(bytes, offset + 2)),
  );
}

/** The eight bytes of one TableBrcOperand.brc field: a BrcMayBeNil ([MS-DOC] 2.9.20) -- "If the last four bytes are 0xFFFFFFFF, the BrcMayBeNil is a NilBrc that specifies that the table cells in question have no border", otherwise a Brc ([MS-DOC] 2.9.16) whose own cv states the colour exactly. */
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

/** dptLineWidth for a border of `widthPt` rendered as `brcType`, in the 1/8-point increments [MS-DOC] states it in. For BRC_TYPE_DOUBLE, `widthPt` is the border's own total rendered width and the field holds one third of it (see DOUBLE_BORDER_WIDTH_MULTIPLIER's own note); every other brcType states `widthPt` directly. Refuses a width the single-byte field cannot hold rather than silently clamping it to a thinner border than the caller asked for, matching how every other out-of-range operand in this writer is handled -- the minimum itself is brcType-dependent (see MIN_DPT_LINE_WIDTH_DOUBLE's own note for why double's own floor is lower than the general one). Accepting a width does not mean it always survives a round trip unchanged, though: for any `double` `widthPt` in the 0.1875pt (inclusive) to 0.5625pt (exclusive) range, the stored dptLineWidth is exactly 1 -- the one value MIN_DPT_LINE_WIDTH_DOUBLE permits that MIN_DPT_LINE_WIDTH would not -- and borderFrom's own read-side floor then raises that 1 to 2 before DOUBLE_BORDER_WIDTH_MULTIPLIER's tripling applies, so e.g. a border written at 0.5pt reads back as 0.75pt, 50% wider than requested. This is a real, [MS-DOC]-consistent narrowing this function deliberately accepts rather than refuses ("values less than 2 are considered to be equivalent to 2" is exactly what a real producer's own reader would apply to the identical bytes), not a silent bug -- decoration.test.ts pins the exact numbers. */
function dptLineWidthFor(widthPt: number, brcType: number): number {
  const multiplier =
    brcType === BRC_TYPE_DOUBLE ? DOUBLE_BORDER_WIDTH_MULTIPLIER : 1;
  const minEighths =
    brcType === BRC_TYPE_DOUBLE
      ? MIN_DPT_LINE_WIDTH_DOUBLE
      : MIN_DPT_LINE_WIDTH;
  const eighths = Math.round((widthPt / multiplier) * EIGHTHS_PER_POINT);
  if (eighths < minEighths || eighths > MAX_DPT_LINE_WIDTH) {
    // Math.round's own tie-breaking means the smallest widthPt this check actually lets through is half an eighth below minEighths's own point value, not minEighths / EIGHTHS_PER_POINT * multiplier -- that naive figure is what a stored dptLineWidth of exactly minEighths converts back to on read, not the boundary this check itself enforces on the way in. Evaluating both branches gives the same number, 0.1875pt -- (2 - 0.5) / 8 for a single-line border, (1 - 0.5) * 3 / 8 for a double one -- a coincidence of the two constants' own values rather than a designed equivalence, but it means dptLineWidthFor's write floor is 0.1875pt across every brcType it handles.
    const minPt = ((minEighths - 0.5) * multiplier) / EIGHTHS_PER_POINT;
    const maxPt = (MAX_DPT_LINE_WIDTH / EIGHTHS_PER_POINT) * multiplier;
    throw new DocFormatError(
      `a table cell border is ${widthPt}pt, outside the ${minPt}..${maxPt}pt range [MS-DOC]'s own single-byte dptLineWidth can state in 1/8-point increments${brcType === BRC_TYPE_DOUBLE ? " of one line's own width, a double border's field being one third of its total rendered width" : ""}`,
    );
  }
  return eighths;
}

/** One TC80 border field's own four bytes: the Brc80MayBeNil no-border sentinel for an absent border, otherwise a real Brc80 whose colour is the nearest Ico the fixed palette offers (see color.ts's nearestIco, and borderNeedsExactColor for how the exact colour still reaches the file). dptSpace, fShadow and fFrame are always zero -- ContentBorder models none of the three, so writing anything else would be inventing a fact the input never stated. */
export function writeBrc80(border: ContentBorder | undefined): number[] {
  if (border === undefined) return [...NIL_BRC80];
  const brcType = STYLE_BRC_TYPE[border.style ?? "solid"];
  return [
    dptLineWidthFor(border.widthPt, brcType),
    brcType,
    nearestIco(border.color),
    0x00,
  ];
}

/** One TableBrcOperand.brc field's own eight bytes: a real Brc carrying the border's colour exactly, as a COLORREF rather than a palette index. Only ever called for a border that exists, since a TableBrcOperand naming no sides is never emitted at all. */
export function writeBrc(border: ContentBorder): number[] {
  const brcType = STYLE_BRC_TYPE[border.style ?? "solid"];
  return [
    ...colorRefBytes(border.color),
    dptLineWidthFor(border.widthPt, brcType),
    brcType,
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

/** ipatAuto, [MS-DOC] 2.9.121: "Clear, ST_Shd: clear" -- the pattern under which a cell simply shows its own cvBack, which is how both Word and LibreOffice spell a flat background colour, and the only pattern this package writes. */
const IPAT_AUTO = 0x0000;
/** ipatSolid, [MS-DOC] 2.9.121: "Solid ST_Shd: solid" -- the cell is filled entirely with cvFore. */
const IPAT_SOLID = 0x0001;

/**
 * One Shd ([MS-DOC] 2.9.247) as a flat background colour, or undefined where it states none.
 *
 * Only the two patterns that genuinely produce a flat fill resolve: ipatAuto, under which the cell shows cvBack (ECMA-376's own `clear` shading with a fill colour, which is what a real producer writes for a plain cell background), and ipatSolid, under which it shows cvFore. Every other Ipat -- the fourteen percentage fills, the stripe and crosshatch families, and ipatNil -- is a genuine pattern that Color cannot express, and reads as no background rather than as one of its two colours: reporting a 50% grey crosshatch as its own foreground colour would misstate what the cell actually shows. This is the same deliberate judgment xls-codec makes for BIFF8's own FillPattern enumeration, for the same reason, and it costs nothing on a round trip because this package's own writer emits ipatAuto and nothing else.
 *
 * A cvAuto colour under either pattern is likewise no background: it designates the application's own default, which for a cell background is "not shaded" rather than a colour to state. ShdAuto and ShdNil -- the two special values [MS-DOC] 2.9.247 names for "no shading is applied" -- both fall out of exactly that, with no separate check: each is a pair of cvAuto colours under ipatAuto.
 */
export function readShd(bytes: Uint8Array, offset: number): Color | undefined {
  const ipat = readUint16LE(bytes, offset + 8);
  if (ipat === IPAT_AUTO) return readColorRef(bytes, offset + 4);
  if (ipat === IPAT_SOLID) return readColorRef(bytes, offset);
  return undefined;
}

/** One Shd's own ten bytes: cvFore left automatic and the background stated as cvBack under ipatAuto, which is exactly how LibreOffice 26.2.5.2 writes a cell fill (confirmed against its own `.doc` output: a #ffff00 cell came back as cvFore cvAuto, cvBack `ff ff 00 00`, ipat 0x0000). An absent background writes ShdAuto -- the all-automatic value [MS-DOC] 2.9.247 defines as "no shading is applied" -- so an undecorated cell inside a row that has decorated ones still states its own lack of shading rather than inheriting a neighbour's. */
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

/** Shd80Nil, [MS-DOC] 2.9.248: icoFore 0x1F, icoBack 0x1F, ipat 0x3F -- every bit set, "specifies that no shading is applied", and explicitly exempt from the Ico and Ipat bounds the fields otherwise carry. */
const SHD80_NIL = 0xffff;

/** One Shd80 ([MS-DOC] 2.9.248) as a flat background colour: the same ipatAuto/ipatSolid reading readShd applies, over the Ico palette rather than COLORREFs. This is the Word 97-era spelling of cell shading, superseded by Shd but still written -- alongside it -- by a real producer, so a file carrying only this one still reads. Never written by this package, which states shading through Shd alone. icoFore/icoBack are each a 5-bit field, so a value the 17-entry palette cannot hold is a real possibility rather than a format-level impossibility; decorativeIcoColor resolves that case to no background instead of aborting the whole document read. */
export function readShd80(value: number): Color | undefined {
  if (value === SHD80_NIL) return undefined;
  const icoFore = value & 0x1f;
  const icoBack = (value >> 5) & 0x1f;
  const ipat = (value >> 10) & 0x3f;
  if (ipat === IPAT_AUTO) return decorativeIcoColor(icoBack);
  if (ipat === IPAT_SOLID) return decorativeIcoColor(icoFore);
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
