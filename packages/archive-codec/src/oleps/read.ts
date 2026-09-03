import {
  BYTE_ORDER_MARK,
  CP_WINUNICODE,
  HEADER_SIZE,
  IDENTIFIER_AND_OFFSET_SIZE,
  PID_CODEPAGE,
  PID_DICTIONARY,
  PROPERTY_SET_HEADER_SIZE,
  TYPED_VALUE_HEADER_SIZE,
  VT_FILETIME,
  VT_I2,
  VT_I4,
  VT_LPSTR,
  VT_LPWSTR,
  WINDOWS_1252_CODEPAGE,
  filetimeToDate,
  readGuid,
  type PropertySet,
  type PropertyValue,
} from "./wire";

// A generic reader for the [MS-OLEPS] Property Set Stream format: the stream header, the single PropertySet packet it names (Size, NumProperties, the PropertyIdentifierAndOffset dictionary, and the typed property values themselves), for VT_I2, VT_I4, VT_LPSTR, VT_LPWSTR, and VT_FILETIME -- the five PropertyType values that cover every property a real [MS-OSHARED] SummaryInformation stream carries (title/subject/author/keywords/comments/template/lastAuthor/appName as strings, created/lastSaved/lastPrinted/editTime as FILETIMEs, pageCount/wordCount/charCount/docSecurity as VT_I4, codePage as VT_I2), so this reader parses a whole real-world stream even though ./summary-information.ts only projects a subset of it into named fields. Zero document-format knowledge: it knows property identifiers and typed values, never that PID 2 means a title or that this stream is conventionally named "\x05SummaryInformation" -- that mapping lives one level up, in ./summary-information.ts, the same layering cfb/ole-package.ts gives the OLE Package stream on top of the generic CFB reader in ../cfb/read.ts.
//
// Two genuine [MS-OLEPS] features are out of scope, deliberately, rather than by oversight: a PropertySetStream can carry two property sets in one physical stream (2.21 -- how DocumentSummaryInformation and its UserDefinedProperties share a stream), and a property set can carry named, dictionary-keyed properties (via PID 0, the Dictionary property) rather than purely numeric ones. Neither ever appears in a "\x05SummaryInformation" stream -- SummaryInformation is always exactly one property set, and its properties are always identified numerically -- so a reader that rejects both stays honest about not reading DocumentSummaryInformation while still parsing every real SummaryInformation stream in full.

export class PropertySetFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PropertySetFormatError";
  }
}

function requireBytes(
  byteLength: number,
  offset: number,
  length: number,
  what: string,
): void {
  if (offset < 0 || length < 0 || offset + length > byteLength) {
    throw new PropertySetFormatError(
      `property set stream ends before ${what} (needs ${length} bytes at offset ${offset}, stream is ${byteLength} bytes)`,
    );
  }
}

const ANSI_DECODER = new TextDecoder("windows-1252");
const UTF16_DECODER = new TextDecoder("utf-16le");

function decodeAnsi(bytes: Uint8Array<ArrayBuffer>, codepage: number): string {
  if (codepage !== WINDOWS_1252_CODEPAGE) {
    throw new PropertySetFormatError(
      `property set declares CodePage ${codepage}, which this reader does not decode (only CP_WINUNICODE/1200 and windows-1252/1252 are supported)`,
    );
  }
  return ANSI_DECODER.decode(bytes);
}

// [MS-OLEPS] 2.19/2.20: both string packets MAY carry embedded or additional trailing null characters beyond the first terminator, and how a reader "presents" such a string to its application is implementation-specific. This one truncates at the first null code unit -- what every string ./write.ts and ./summary-information.ts actually produce needs (a plain string, no embedded nulls), and what the spec's own worked SummaryInformation example requires to read an empty property back as "" rather than as embedded NUL characters (its KEYWORDS property is four zero bytes: Size 4, not the minimal Size 1 a null-terminator-only empty string would use).
function truncateAtNull(value: string): string {
  const index = value.indexOf("\u0000");
  return index === -1 ? value : value.slice(0, index);
}

// [MS-OLEPS] 2.19 CodePageString: Size(4) is the byte length of Characters including its null terminator but excluding padding; Characters is that many bytes, ANSI- or UTF-16LE-encoded depending on the property set's own CodePage property, padded to a 4-byte boundary.
function readCodePageString(
  bytes: Uint8Array<ArrayBuffer>,
  view: DataView,
  offset: number,
  codepage: number,
): string {
  requireBytes(bytes.length, offset, 4, "a CodePageString's Size field");
  const size = view.getUint32(offset, true);
  requireBytes(
    bytes.length,
    offset + 4,
    size,
    "a CodePageString's Characters field",
  );
  const raw = bytes.subarray(offset + 4, offset + 4 + size);
  return codepage === CP_WINUNICODE
    ? truncateAtNull(UTF16_DECODER.decode(raw))
    : truncateAtNull(decodeAnsi(raw, codepage));
}

// [MS-OLEPS] 2.20 UnicodeString: Length(4) is the UTF-16 code-unit count of Characters including its null terminator but excluding padding; Characters is that many 16-bit units, always UTF-16LE regardless of the property set's CodePage property, padded to a 4-byte boundary.
function readUnicodeString(
  bytes: Uint8Array<ArrayBuffer>,
  view: DataView,
  offset: number,
): string {
  requireBytes(bytes.length, offset, 4, "a UnicodeString's Length field");
  const units = view.getUint32(offset, true);
  const byteLength = units * 2;
  requireBytes(
    bytes.length,
    offset + 4,
    byteLength,
    "a UnicodeString's Characters field",
  );
  const raw = bytes.subarray(offset + 4, offset + 4 + byteLength);
  return truncateAtNull(UTF16_DECODER.decode(raw));
}

interface DictionaryEntry {
  readonly pid: number;
  readonly relativeOffset: number;
}

// Parses a [MS-OLEPS] Property Set Stream: the header (validating ByteOrder and the single-property-set requirement above), the PropertySet packet's dictionary, and every property's typed value. Throws PropertySetFormatError on any structural nonconformance or on a property type this reader does not decode -- loud failure, never a partial property map that looks complete.
export function readPropertySetStream(
  bytes: Uint8Array<ArrayBuffer>,
): PropertySet {
  requireBytes(bytes.length, 0, HEADER_SIZE, "the PropertySetStream header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const byteOrder = view.getUint16(0, true);
  if (byteOrder !== BYTE_ORDER_MARK) {
    throw new PropertySetFormatError(
      `property set stream's ByteOrder field is 0x${byteOrder.toString(16)}, not the mandated 0xFFFE`,
    );
  }
  const numPropertySets = view.getUint32(24, true);
  if (numPropertySets !== 1) {
    throw new PropertySetFormatError(
      `property set stream declares ${numPropertySets} property sets; this reader only handles the single-property-set form every "\\x05SummaryInformation" stream uses (the two-property-set DocumentSummaryInformation/UserDefinedProperties spelling is out of scope, see the package README)`,
    );
  }
  const formatId = readGuid(view, 28);
  const offset0 = view.getUint32(44, true);

  requireBytes(
    bytes.length,
    offset0,
    PROPERTY_SET_HEADER_SIZE,
    "the PropertySet packet header",
  );
  const size = view.getUint32(offset0, true);
  requireBytes(
    bytes.length,
    offset0,
    size,
    "the PropertySet packet's own declared Size",
  );
  const numProperties = view.getUint32(offset0 + 4, true);

  const tableStart = offset0 + PROPERTY_SET_HEADER_SIZE;
  requireBytes(
    bytes.length,
    tableStart,
    numProperties * IDENTIFIER_AND_OFFSET_SIZE,
    "the PropertyIdentifierAndOffset dictionary",
  );
  const entries: DictionaryEntry[] = [];
  for (let i = 0; i < numProperties; i++) {
    const entryOffset = tableStart + i * IDENTIFIER_AND_OFFSET_SIZE;
    const pid = view.getUint32(entryOffset, true);
    if (pid === PID_DICTIONARY) {
      throw new PropertySetFormatError(
        'property set carries a Dictionary property (PID 0), which names string-keyed properties this reader does not support -- no "\\x05SummaryInformation" stream should carry one',
      );
    }
    entries.push({
      pid,
      relativeOffset: view.getUint32(entryOffset + 4, true),
    });
  }

  // Two-pass: the CodePage property governs how every VT_LPSTR value in the SAME property set decodes, so it must be resolved before any string is read, regardless of where the dictionary lists PID 1 relative to the properties that need it. Absent CodePage is treated as windows-1252, the overwhelmingly common real-world default, rather than refused outright -- a stream a real producer wrote without one should still read.
  let codepage = WINDOWS_1252_CODEPAGE;
  for (const entry of entries) {
    if (entry.pid !== PID_CODEPAGE) continue;
    const abs = offset0 + entry.relativeOffset;
    requireBytes(
      bytes.length,
      abs,
      TYPED_VALUE_HEADER_SIZE + 4,
      "the CodePage property's TypedPropertyValue",
    );
    const type = view.getUint16(abs, true);
    if (type !== VT_I2) {
      throw new PropertySetFormatError(
        `CodePage property (PID 1) has type 0x${type.toString(16)}, not VT_I2 as [MS-OLEPS] requires`,
      );
    }
    const raw = view.getInt16(abs + TYPED_VALUE_HEADER_SIZE, true);
    // Codepages above 32767 are conventionally stored as their negative 16-bit twos-complement equivalent, since VT_I2's own Value is a signed integer.
    codepage = raw < 0 ? raw + 0x10000 : raw;
  }

  const properties = new Map<number, PropertyValue>();
  for (const entry of entries) {
    const abs = offset0 + entry.relativeOffset;
    requireBytes(
      bytes.length,
      abs,
      TYPED_VALUE_HEADER_SIZE,
      "a property's TypedPropertyValue header",
    );
    const type = view.getUint16(abs, true);
    const padding = view.getUint16(abs + 2, true);
    if (padding !== 0) {
      throw new PropertySetFormatError(
        `property ${entry.pid}'s TypedPropertyValue padding is 0x${padding.toString(16)}, not zero as [MS-OLEPS] requires`,
      );
    }
    const valueOffset = abs + TYPED_VALUE_HEADER_SIZE;
    switch (type) {
      case VT_I2: {
        requireBytes(
          bytes.length,
          valueOffset,
          4,
          `property ${entry.pid}'s VT_I2 value`,
        );
        properties.set(entry.pid, {
          type: "VT_I2",
          value: view.getInt16(valueOffset, true),
        });
        break;
      }
      case VT_I4: {
        requireBytes(
          bytes.length,
          valueOffset,
          4,
          `property ${entry.pid}'s VT_I4 value`,
        );
        properties.set(entry.pid, {
          type: "VT_I4",
          value: view.getInt32(valueOffset, true),
        });
        break;
      }
      case VT_LPSTR: {
        const value = readCodePageString(bytes, view, valueOffset, codepage);
        properties.set(entry.pid, { type: "VT_LPSTR", value });
        break;
      }
      case VT_LPWSTR: {
        const value = readUnicodeString(bytes, view, valueOffset);
        properties.set(entry.pid, { type: "VT_LPWSTR", value });
        break;
      }
      case VT_FILETIME: {
        requireBytes(
          bytes.length,
          valueOffset,
          8,
          `property ${entry.pid}'s VT_FILETIME value`,
        );
        const low = view.getUint32(valueOffset, true);
        const high = view.getUint32(valueOffset + 4, true);
        properties.set(entry.pid, {
          type: "VT_FILETIME",
          value: filetimeToDate(low, high),
        });
        break;
      }
      default:
        throw new PropertySetFormatError(
          `property ${entry.pid} has type 0x${type.toString(16)}, which this reader does not decode (supported: VT_I2, VT_I4, VT_LPSTR, VT_LPWSTR, VT_FILETIME)`,
        );
    }
  }

  return { formatId, properties };
}
