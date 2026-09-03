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
