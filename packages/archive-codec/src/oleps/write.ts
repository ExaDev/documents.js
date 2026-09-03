import {
  BYTE_ORDER_MARK,
  GUID_NULL,
  HEADER_SIZE,
  IDENTIFIER_AND_OFFSET_SIZE,
  PROPERTY_SET_HEADER_SIZE,
  TYPED_VALUE_HEADER_SIZE,
  VT_FILETIME,
  VT_I2,
  VT_I4,
  VT_LPWSTR,
  dateToFiletime,
  writeGuid,
  type PropertySet,
  type PropertyValue,
} from "./wire";

// The write half of the generic [MS-OLEPS] Property Set Stream reader in ./read.ts: given the same {formatId, properties} vocabulary that reads, it emits a conformant single-property-set stream -- header, PropertySet packet (Size, NumProperties, the PropertyIdentifierAndOffset dictionary, and the typed values themselves). Deliberately the mirror of readPropertySetStream: writePropertySetStream(readPropertySetStream(bytes)) is a well-typed round trip rather than a translation between two vocabularies, exactly as cfb/write.ts is to cfb/read.ts.
//
// Purely mechanical: this writer emits exactly the properties it is given, in PID order, and injects nothing of its own (no default CodePage, no synthesized property) -- the same "output depends only on what was asked for, never a guess about what a well-formed stream should also contain" discipline cfb/write.ts holds for stream paths. Constructing a properties map that is actually a well-formed "\x05SummaryInformation" stream (title/author/dates mapped onto the right PIDs, a CodePage property included) is ./summary-information.ts's job, one level up.
//
// Narrower than the reader in one respect, deliberately: VT_LPSTR (CodePageString) is not written, only VT_LPWSTR (UnicodeString). A CodePageString's ANSI encoding depends on the property set's own CodePage property, and writing an arbitrary codepage's byte encoding would need a full codepage table this package does not have (the reader only ever decodes windows-1252 or CP_WINUNICODE for the same reason -- see ./read.ts). Writing Unicode strings unconditionally sidesteps the whole question: VT_LPWSTR is always UTF-16LE regardless of CodePage, so every string this package's callers actually need to write (arbitrary document titles/authors, not constrained to Latin-1) round-trips losslessly without a codepage table.

export class PropertySetWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PropertySetWriteError";
  }
}

// [MS-OLEPS] 2.20 UnicodeString's own Characters field: a null-terminated array of 16-bit code units. JS strings are already sequences of UTF-16 code units, so this copies charCodeAt directly rather than re-encoding -- a surrogate pair round-trips as its own two code units with no special-casing needed, since nothing here interprets code-point boundaries.
function encodeUnicodeStringValue(value: string): Uint8Array<ArrayBuffer> {
  const characterBytes = new Uint8Array((value.length + 1) * 2);
  const charView = new DataView(characterBytes.buffer);
  for (let i = 0; i < value.length; i++) {
    charView.setUint16(i * 2, value.charCodeAt(i), true);
  }
  charView.setUint16(value.length * 2, 0, true); // the null terminator [MS-OLEPS] 2.20 requires
  return characterBytes;
}

function padTo4(length: number): number {
  return Math.ceil(length / 4) * 4;
}

// Encodes one property's TypedPropertyValue: Type(2) + Padding(2), then the Value field per [MS-OLEPS] 2.15. Every branch's total length is already a multiple of 4 bytes (VT_I2/VT_I4 pad their 2-/4-byte value out to 4; VT_FILETIME's 8-byte value needs none; VT_LPWSTR's own padding rule ensures it), so packing successive properties back-to-back keeps every later property's own offset naturally 4-byte aligned without extra bookkeeping.
function encodeTypedPropertyValue(
  value: PropertyValue,
): Uint8Array<ArrayBuffer> {
  switch (value.type) {
    case "VT_I2": {
      const bytes = new Uint8Array(TYPED_VALUE_HEADER_SIZE + 4);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, VT_I2, true);
      view.setUint16(2, 0, true);
      view.setInt16(4, value.value, true);
      view.setUint16(6, 0, true);
      return bytes;
    }
    case "VT_I4": {
      const bytes = new Uint8Array(TYPED_VALUE_HEADER_SIZE + 4);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, VT_I4, true);
      view.setUint16(2, 0, true);
      view.setInt32(4, value.value, true);
      return bytes;
    }
    case "VT_FILETIME": {
      const { low, high } = dateToFiletime(value.value);
      const bytes = new Uint8Array(TYPED_VALUE_HEADER_SIZE + 8);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, VT_FILETIME, true);
      view.setUint16(2, 0, true);
      view.setUint32(4, low, true);
      view.setUint32(8, high, true);
      return bytes;
    }
    case "VT_LPWSTR": {
      const characters = encodeUnicodeStringValue(value.value);
      const paddedLength = padTo4(characters.length);
      const bytes = new Uint8Array(TYPED_VALUE_HEADER_SIZE + 4 + paddedLength);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, VT_LPWSTR, true);
      view.setUint16(2, 0, true);
      view.setUint32(4, characters.length / 2, true); // Length is in 16-bit units, not bytes
      bytes.set(characters, TYPED_VALUE_HEADER_SIZE + 4);
      return bytes;
    }
    case "VT_LPSTR":
      throw new PropertySetWriteError(
        "writePropertySetStream cannot write a VT_LPSTR property: this writer emits Unicode (VT_LPWSTR) strings only, since encoding to an arbitrary ANSI codepage is out of scope -- see the package README's OLEPS scope note",
      );
  }
}

// Writes a conformant [MS-OLEPS] Property Set Stream carrying exactly one property set, in the shape readPropertySetStream returns.
export function writePropertySetStream(
  propertySet: PropertySet,
): Uint8Array<ArrayBuffer> {
  const entries = [...propertySet.properties.entries()].sort(
    ([a], [b]) => a - b,
  );

  const dictionaryBytes = new Uint8Array(
    entries.length * IDENTIFIER_AND_OFFSET_SIZE,
  );
  const dictionaryView = new DataView(dictionaryBytes.buffer);
  const valueChunks: Uint8Array<ArrayBuffer>[] = [];
  let valueOffset = PROPERTY_SET_HEADER_SIZE + dictionaryBytes.length;
  let index = 0;
  for (const [pid, value] of entries) {
    const encoded = encodeTypedPropertyValue(value);
    dictionaryView.setUint32(index * IDENTIFIER_AND_OFFSET_SIZE, pid, true);
    dictionaryView.setUint32(
      index * IDENTIFIER_AND_OFFSET_SIZE + 4,
      valueOffset,
      true,
    );
    valueChunks.push(encoded);
    valueOffset += encoded.length;
    index += 1;
  }
  const propertySetSize = valueOffset;

  const propertySetBytes = new Uint8Array(propertySetSize);
  const propertySetView = new DataView(propertySetBytes.buffer);
  propertySetView.setUint32(0, propertySetSize, true);
  propertySetView.setUint32(4, entries.length, true);
  propertySetBytes.set(dictionaryBytes, PROPERTY_SET_HEADER_SIZE);
  let cursor = PROPERTY_SET_HEADER_SIZE + dictionaryBytes.length;
  for (const chunk of valueChunks) {
    propertySetBytes.set(chunk, cursor);
    cursor += chunk.length;
  }

  const streamBytes = new Uint8Array(HEADER_SIZE + propertySetBytes.length);
  const view = new DataView(streamBytes.buffer);
  view.setUint16(0, BYTE_ORDER_MARK, true);
  view.setUint16(2, 0, true); // Version 0: none of the types this writer emits need version 1's extra features
  view.setUint32(4, 0, true); // SystemIdentifier is implementation-specific and MUST be ignored by readers ([MS-OLEPS] 2.21); zero rather than impersonating a real OS identifier
  writeGuid(view, 8, GUID_NULL); // CLSID: this package has no notion of a property set's own associated CLSID to record
  view.setUint32(24, 1, true); // NumPropertySets
  writeGuid(view, 28, propertySet.formatId);
  view.setUint32(44, HEADER_SIZE, true); // Offset0
  streamBytes.set(propertySetBytes, HEADER_SIZE);
  return streamBytes;
}
