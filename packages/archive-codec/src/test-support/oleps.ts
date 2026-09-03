// A hand-built [MS-OLEPS] Property Set Stream encoder for the oleps reader's tests, independent of oleps/write.ts's own construction (the same "test-support hand-rolls its own bytes rather than reusing the module under test" discipline test-support/cfb.ts already follows for the CFB reader): given a formatId and a list of typed field specs, it emits a genuine single-property-set stream -- header, then the PropertySet packet's Size/NumProperties/PropertyIdentifierAndOffset dictionary/typed values -- whose bytes the reader under test must parse back into the same fields.
//
// Test-support only: excluded from the published dist per the family convention.

export type FieldValue =
  | { readonly type: "VT_I2"; readonly value: number }
  | { readonly type: "VT_I4"; readonly value: number }
  | { readonly type: "VT_LPSTR"; readonly value: string } // ASCII only -- windows-1252 and ASCII agree below 0x80, which is all these tests ever need to encode
  | { readonly type: "VT_LPSTR_UTF16"; readonly value: string } // a VT_LPSTR (0x001E) CodePageString whose Characters are UTF-16LE -- what a real producer writes when the property set's own CodePage declares CP_WINUNICODE ([MS-OLEPS] 2.19)
  | { readonly type: "VT_LPWSTR"; readonly value: string }
  | {
      readonly type: "VT_FILETIME";
      readonly low: number;
      readonly high: number;
    };

export interface FieldSpec {
  readonly pid: number;
  readonly value: FieldValue;
}

const VT_I2 = 0x0002;
const VT_I4 = 0x0003;
const VT_LPSTR = 0x001e;
const VT_LPWSTR = 0x001f;
const VT_FILETIME = 0x0040;

function padTo4(length: number): number {
  return Math.ceil(length / 4) * 4;
}

function writeGuid(view: DataView, offset: number, guid: string): void {
  const digits = guid.replace(/[{}-]/g, "");
  view.setUint32(offset, Number.parseInt(digits.slice(0, 8), 16), true);
  view.setUint16(offset + 4, Number.parseInt(digits.slice(8, 12), 16), true);
  view.setUint16(offset + 6, Number.parseInt(digits.slice(12, 16), 16), true);
  for (let i = 0; i < 8; i++) {
    view.setUint8(
      offset + 8 + i,
      Number.parseInt(digits.slice(16 + i * 2, 18 + i * 2), 16),
    );
  }
}

function encodeAsciiCodePageString(value: string): Uint8Array<ArrayBuffer> {
  const size = value.length + 1; // + null terminator
  const bytes = new Uint8Array(4 + padTo4(size));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, size, true);
  for (let i = 0; i < value.length; i++) {
    bytes[4 + i] = value.charCodeAt(i);
  }
  return bytes;
}

function encodeUnicodeString(value: string): Uint8Array<ArrayBuffer> {
  const units = value.length + 1; // + null terminator
  const charBytes = units * 2;
  const bytes = new Uint8Array(4 + padTo4(charBytes));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, units, true);
  for (let i = 0; i < value.length; i++) {
    view.setUint16(4 + i * 2, value.charCodeAt(i), true);
  }
  return bytes;
}

function encodeValue(value: FieldValue): Uint8Array<ArrayBuffer> {
  switch (value.type) {
    case "VT_I2": {
      const bytes = new Uint8Array(8);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, VT_I2, true);
      view.setInt16(4, value.value, true);
      return bytes;
    }
    case "VT_I4": {
      const bytes = new Uint8Array(8);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, VT_I4, true);
      view.setInt32(4, value.value, true);
      return bytes;
    }
    case "VT_FILETIME": {
      const bytes = new Uint8Array(12);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, VT_FILETIME, true);
      view.setUint32(4, value.low, true);
      view.setUint32(8, value.high, true);
      return bytes;
    }
    case "VT_LPSTR": {
      const characters = encodeAsciiCodePageString(value.value);
      const bytes = new Uint8Array(4 + characters.length);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, VT_LPSTR, true);
      bytes.set(characters, 4);
      return bytes;
    }
    case "VT_LPSTR_UTF16": {
      // The identical CodePageString shape VT_LPSTR uses (Size, then null-terminated Characters padded to 4 bytes), but Characters is UTF-16LE, not ASCII -- Size therefore counts bytes, not code units, and is twice encodeUnicodeString's own Length.
      const wide = encodeUnicodeString(value.value);
      const wideView = new DataView(wide.buffer);
      const units = wideView.getUint32(0, true);
      wideView.setUint32(0, units * 2, true);
      const bytes = new Uint8Array(4 + wide.length);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, VT_LPSTR, true);
      bytes.set(wide, 4);
      return bytes;
    }
    case "VT_LPWSTR": {
      const characters = encodeUnicodeString(value.value);
      const bytes = new Uint8Array(4 + characters.length);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, VT_LPWSTR, true);
      bytes.set(characters, 4);
      return bytes;
    }
  }
}

/** Builds a single-property-set [MS-OLEPS] PropertySetStream: header (ByteOrder/Version/SystemIdentifier/CLSID=GUID_NULL/NumPropertySets=1/FMTID0/Offset0), then the PropertySet packet -- fields emitted in the given order, each entry's PropertyIdentifierAndOffset pointing at its own value, immediately after the dictionary. */
export function propertySetStream(
  formatId: string,
  fields: readonly FieldSpec[],
): Uint8Array<ArrayBuffer> {
  const HEADER_SIZE = 48;
  const dictionarySize = fields.length * 8;

  interface PlacedField {
    readonly pid: number;
    readonly offset: number;
    readonly bytes: Uint8Array<ArrayBuffer>;
  }
  const placed: PlacedField[] = [];
  let valueOffset = 8 + dictionarySize;
  for (const field of fields) {
    const bytes = encodeValue(field.value);
    placed.push({ pid: field.pid, offset: valueOffset, bytes });
    valueOffset += bytes.length;
  }
  const propertySetSize = valueOffset;

  const propertySetBytes = new Uint8Array(propertySetSize);
  const psView = new DataView(propertySetBytes.buffer);
  psView.setUint32(0, propertySetSize, true);
  psView.setUint32(4, placed.length, true);
  placed.forEach((field, index) => {
    psView.setUint32(8 + index * 8, field.pid, true);
    psView.setUint32(8 + index * 8 + 4, field.offset, true);
    propertySetBytes.set(field.bytes, field.offset);
  });

  const streamBytes = new Uint8Array(HEADER_SIZE + propertySetBytes.length);
  const view = new DataView(streamBytes.buffer);
  view.setUint16(0, 0xfffe, true); // ByteOrder
  view.setUint16(2, 0, true); // Version
  view.setUint32(4, 0, true); // SystemIdentifier
  writeGuid(view, 8, "{00000000-0000-0000-0000-000000000000}"); // CLSID = GUID_NULL
  view.setUint32(24, 1, true); // NumPropertySets
  writeGuid(view, 28, formatId); // FMTID0
  view.setUint32(44, HEADER_SIZE, true); // Offset0
  streamBytes.set(propertySetBytes, HEADER_SIZE);
  return streamBytes;
}
