// Builders for hand-constructed BIFF8 byte sequences, so every reader test states its input as the field layout [MS-XLS] specifies rather than as an opaque blob captured from some producer. A test failure then points at this package's reading of the specification, which is the thing under test.
//
// Test-support only: excluded from the published dist by tsdown.config.ts, and exempt from the Worker-isomorphism lint rule.

/** A record's three-component framing ([MS-XLS] 2.1.4): a little-endian type, a little-endian size, then the data. */
export function record(
  type: number,
  data: readonly number[],
): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    type & 0xff,
    (type >> 8) & 0xff,
    data.length & 0xff,
    (data.length >> 8) & 0xff,
    ...data,
  ]);
}

export function concat(
  ...parts: readonly Uint8Array<ArrayBuffer>[]
): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function u16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

export function u32(value: number): number[] {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}

/** An Xnum ([MS-XLS] 2.5.342): a little-endian IEEE 754 double. */
export function f64(value: number): number[] {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, true);
  return [...new Uint8Array(buffer)];
}

/** An XLUnicodeString ([MS-XLS] 2.5.294), written compressed when every character fits in a low byte and uncompressed otherwise -- the same choice a real producer makes. */
export function xlUnicodeString(text: string): number[] {
  const { flags, rgb } = encodeCharacters(text);
  return [...u16(text.length), flags, ...rgb];
}

/** A ShortXLUnicodeString ([MS-XLS] 2.5.240): as above with a one-byte character count. */
export function shortXlUnicodeString(text: string): number[] {
  const { flags, rgb } = encodeCharacters(text);
  return [text.length & 0xff, flags, ...rgb];
}

/** An XLUnicodeRichExtendedString ([MS-XLS] 2.5.293) carrying neither formatting runs nor phonetic data -- the shape a plain SST entry has. */
export function richExtendedString(text: string): number[] {
  const { flags, rgb } = encodeCharacters(text);
  return [...u16(text.length), flags, ...rgb];
}

function encodeCharacters(text: string): { flags: number; rgb: number[] } {
  const needsHighByte = [...text].some((char) => char.charCodeAt(0) > 0xff);
  if (!needsHighByte) {
    return {
      flags: 0x00,
      rgb: [...text].map((char) => char.charCodeAt(0)),
    };
  }
  const rgb: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    rgb.push(unit & 0xff, (unit >> 8) & 0xff);
  }
  return { flags: 0x01, rgb };
}

/** A BOF record's data ([MS-XLS] 2.4.21), declaring BIFF8 and the given substream document type. The history fields carry values a real producer writes; none of them is read. */
export function bofData(documentType: number): number[] {
  return [
    ...u16(0x0600),
    ...u16(documentType),
    ...u16(0x0dbb),
    ...u16(0x07cc),
    ...u32(0x00000041),
    ...u32(0x00000206),
  ];
}

/** The 32-bit word of an RkNumber ([MS-XLS] 2.5.217) holding a signed integer payload. */
export function rkInteger(value: number, times100 = false): number[] {
  const payload = (value << 2) >>> 0;
  return u32(((payload | 0x02 | (times100 ? 0x01 : 0)) >>> 0) >>> 0);
}

/** The 32-bit word of an RkNumber holding the top 30 bits of a double. The low 34 bits of the double MUST be zero, which the caller's chosen value has to satisfy. */
export function rkDouble(value: number, times100 = false): number[] {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  const high = view.getUint32(0, false);
  return u32((((high & ~0x03) >>> 0) | (times100 ? 0x01 : 0)) >>> 0);
}

/** A Cell structure ([MS-XLS] 2.5.19): row, column, and the index of the XF record giving its format. */
export function cell(row: number, column: number, xfIndex = 15): number[] {
  return [...u16(row), ...u16(column), ...u16(xfIndex)];
}

/** One border edge's own raw fields, for cellXfTrailer below -- a BorderStyle line-style token (0 = no border) and a 7-bit icv colour index. */
export interface XfTestBorderEdge {
  readonly style: number;
  readonly icv: number;
}

/** The decoration fields cellXfTrailer packs, in the same shape src/biff/xf-colors.ts's own XfDecorationFields carries -- kept as a separate, independently-written literal here rather than imported, so a test asserting against this fixture's own bytes is checking the reader's understanding of the spec, not agreement with the writer's packing code (see this module's own top comment). */
export interface XfTestDecoration {
  readonly fillPattern?: number;
  readonly fillForegroundIcv?: number;
  readonly left?: XfTestBorderEdge;
  readonly right?: XfTestBorderEdge;
  readonly top?: XfTestBorderEdge;
  readonly bottom?: XfTestBorderEdge;
}

const NO_EDGE: XfTestBorderEdge = { style: 0, icv: 0 };

/** IcvXF's own "default foreground colour" special value (icv 0x40) -- a literal taken directly from [MS-XLS]'s Icv table, the value a genuinely undecorated real Excel-written XF carries in icvFore. Kept as its own literal here rather than imported from src/biff/xf-colors.ts, for the same reason the rest of this fixture builder is independently written (see this module's own top comment). */
const ICV_DEFAULT_FOREGROUND = 0x40;

/** An XF record's own trailing CellXF/StyleXF "Data" payload ([MS-XLS] 2.4.353), 14 bytes: a leading alignment word (always the schema's own General/Bottom/no-wrap default here, since this package's reader does not act on alignment), then the border word, fill-pattern word, and fill-colour word `decoration` packs -- no borders and no fill pattern when omitted, with icvFore at its own real-file default (0x40, "Automatic") unless the caller states one -- a legal payload every XF record needs regardless of whether a test cares about decoration. */
export function cellXfTrailer(decoration: XfTestDecoration = {}): number[] {
  const left = decoration.left ?? NO_EDGE;
  const right = decoration.right ?? NO_EDGE;
  const top = decoration.top ?? NO_EDGE;
  const bottom = decoration.bottom ?? NO_EDGE;
  const word1 = 0;
  const word2 =
    (left.style & 0xf) |
    ((right.style & 0xf) << 4) |
    ((top.style & 0xf) << 8) |
    ((bottom.style & 0xf) << 12) |
    ((left.icv & 0x7f) << 16) |
    ((right.icv & 0x7f) << 23);
  const word3 =
    (top.icv & 0x7f) |
    ((bottom.icv & 0x7f) << 7) |
    (((decoration.fillPattern ?? 0) & 0x3f) << 26);
  // icvBack (bits 7-13) is always 0 here -- unused by this package's own resolveFillBackground ("only icvFore is rendered" for a solid fill), so no test needs it non-zero.
  const word4 = (decoration.fillForegroundIcv ?? ICV_DEFAULT_FOREGROUND) & 0x7f;
  return [...u32(word1), ...u32(word2), ...u32(word3), ...u16(word4)];
}
