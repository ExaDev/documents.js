import type { Color } from "document-schema.js";
import { readUint8 } from "./bytes";
import { DocFormatError } from "./errors";

// The two colour encodings [MS-DOC] uses throughout, in one place: the fixed 17-entry Ico palette ([MS-DOC] 2.9.119) and the exact 4-byte COLORREF ([MS-DOC] 2.9.43). Neither belongs to any one property family -- a run's colour states one through sprmCIco/sprmCCv (prop/chp.ts, prop/chp-write.ts), a table cell's border and shading state the same two through Brc80.ico/Brc.cv and Shd80/Shd (table/decoration.ts) -- so both live here rather than in whichever module happened to need them first.

const COLOR_COMPONENT_MAX = 255;

// The Ico palette, [MS-DOC] 2.9.119, reproduced exactly as published. Entry 0x00 is the one with fAuto set -- "the default color for the application" -- so it names no concrete colour, and a caller decides what an automatic colour means for the property it is reading rather than this table choosing on the format's behalf.
//
// Entries 0x0C and 0x0D carry identical RGB values (0x80/0x00/0x80) in the published table, where the surrounding entries' pattern and every other palette of this shape would put dark red at 0x0D. That is reproduced rather than corrected: the table above is the normative statement of what the value means, and silently substituting a different colour would make this reader disagree with the specification it claims to implement on a point no test could catch. If a real-world corpus ever shows producers meaning dark red, that is the evidence to change it on.
const ICO_PALETTE: readonly (readonly [number, number, number] | undefined)[] =
  [
    undefined, // 0x00, fAuto -- automatic, no concrete colour.
    [0x00, 0x00, 0x00], // 0x01
    [0x00, 0x00, 0xff], // 0x02
    [0x00, 0xff, 0xff], // 0x03
    [0x00, 0xff, 0x00], // 0x04
    [0xff, 0x00, 0xff], // 0x05
    [0xff, 0x00, 0x00], // 0x06
    [0xff, 0xff, 0x00], // 0x07
    [0xff, 0xff, 0xff], // 0x08
    [0x00, 0x00, 0x80], // 0x09
    [0x00, 0x80, 0x80], // 0x0A
    [0x00, 0x80, 0x00], // 0x0B
    [0x80, 0x00, 0x80], // 0x0C
    [0x80, 0x00, 0x80], // 0x0D -- as published; see the note above.
    [0x80, 0x80, 0x00], // 0x0E
    [0x80, 0x80, 0x80], // 0x0F
    [0xc0, 0xc0, 0xc0], // 0x10
  ];

/** The first Ico value naming a concrete colour: 0x00 is cvAuto and names none, so nearestIco never returns it. */
const FIRST_CONCRETE_ICO = 0x01;

/** The colour an Ico value names, or undefined for 0x00 (fAuto, "the default color for the application", which names no concrete colour). Throws for a value outside the palette's own published bound rather than resolving it to something. */
export function icoColor(value: number): Color | undefined {
  if (value >= ICO_PALETTE.length) {
    throw new DocFormatError(
      `Ico value 0x${value.toString(16)} is not less than 0x11, the bound [MS-DOC] 2.9.119 places on the palette`,
    );
  }
  const entry = ICO_PALETTE[value];
  if (entry === undefined) return undefined;
  const [r, g, b] = entry;
  return {
    r: r / COLOR_COMPONENT_MAX,
    g: g / COLOR_COMPONENT_MAX,
    b: b / COLOR_COMPONENT_MAX,
  };
}

/** icoColor's own decorative counterpart: an out-of-range Ico value resolves to undefined (the same "no concrete colour" spelling 0x00/cvAuto already carries) rather than throwing. icoColor's hard bound stays exactly as it is for a run's sprmCIco, where an out-of-range value states a specific, load-bearing colour this reader must not silently drop -- but Brc80.ico and Shd80's icoFore/icoBack (table/decoration.ts) are cosmetic fields already reached through a chain of automatic-colour fallbacks of their own (borderFrom's own AUTOMATIC_BORDER_COLOR, readShd80's own undefined return for an unrecognised pattern), so one out-of-range byte in a single cell's border or fill should not abort reading the entire document the way it correctly does for a run's own explicit, load-bearing colour. */
export function decorativeIcoColor(value: number): Color | undefined {
  return value >= ICO_PALETTE.length ? undefined : icoColor(value);
}

/**
 * The Ico value whose own colour is closest to `color`, by squared distance in sRGB, over the sixteen entries that name a concrete colour -- 0x00 (cvAuto) is never returned, since it names none. Ties resolve to the lower Ico, which makes the answer depend only on the colour asked about and not on iteration order (it also settles 0x0C/0x0D, the one duplicated pair in the published palette, on 0x0C).
 *
 * This is a genuinely lossy quantisation and is only ever used where [MS-DOC] itself offers no better field: Brc80.ico, the border colour a TC80 can carry at all. Wherever the format has an exact spelling beside it -- Brc.cv, reached through sprmTSetBrc -- this package writes that too, so nothing downstream has to read the approximation back (see table/decoration.ts and the README's own Tables section).
 */
export function nearestIco(color: Color): number {
  let best = FIRST_CONCRETE_ICO;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let value = FIRST_CONCRETE_ICO; value < ICO_PALETTE.length; value += 1) {
    const entry = ICO_PALETTE[value];
    if (entry === undefined) continue;
    const [r, g, b] = entry;
    const dr = color.r - r / COLOR_COMPONENT_MAX;
    const dg = color.g - g / COLOR_COMPONENT_MAX;
    const db = color.b - b / COLOR_COMPONENT_MAX;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = value;
    }
  }
  return best;
}

/** COLORREF's fAuto, [MS-DOC] 2.9.43: "If fAuto is 0xFF, this COLORREF designates the default color for the application", which the specification names cvAuto. */
const F_AUTO_SET = 0xff;

/** COLORREF, [MS-DOC] 2.9.43: red, green and blue bytes followed by fAuto. Returns undefined for cvAuto (fAuto set), which designates the application's own default colour rather than the components beside it -- the caller decides what that means for the property it is reading. */
export function readColorRef(
  bytes: Uint8Array,
  offset: number,
): Color | undefined {
  if (readUint8(bytes, offset + 3) !== 0x00) return undefined;
  return {
    r: readUint8(bytes, offset) / COLOR_COMPONENT_MAX,
    g: readUint8(bytes, offset + 1) / COLOR_COMPONENT_MAX,
    b: readUint8(bytes, offset + 2) / COLOR_COMPONENT_MAX,
  };
}

/** The inverse of readColorRef for a concrete colour: red, green, blue, then fAuto 0x00 ("use these components"), the only form this package writes. */
export function colorRefBytes(color: Color): number[] {
  const byte = (component: number): number =>
    Math.round(component * COLOR_COMPONENT_MAX);
  return [byte(color.r), byte(color.g), byte(color.b), 0x00];
}

/** cvAuto's own four bytes, [MS-DOC] 2.9.43: components zeroed with fAuto set. Written wherever a COLORREF field exists but this package has no colour to state for it -- a Shd's own cvFore under an ipatAuto pattern, for instance. */
export function autoColorRefBytes(): number[] {
  return [0x00, 0x00, 0x00, F_AUTO_SET];
}
