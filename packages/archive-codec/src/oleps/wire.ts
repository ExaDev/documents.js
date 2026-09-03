// The [MS-OLEPS] Property Set Stream wire format's shared vocabulary: the PropertyType codes, the two reserved property identifiers, the codepage constants, the fixed structural sizes, and the two symmetric codecs (GUID and FILETIME) both ./read.ts and ./write.ts need identically. A true single source of truth rather than each direction restating its own copy: unlike cfb/write.ts's own FAT special values (a handful of independent constants where duplication risks no real drift), a GUID or FILETIME transcribed slightly differently in each direction would silently break every round trip, so the one correct engineering choice here is one definition both sides import.

// [MS-OLEPS] 2.21 PropertySetStream: mandated at the start of every property set stream.
export const BYTE_ORDER_MARK = 0xfffe;
// ByteOrder(2) + Version(2) + SystemIdentifier(4) + CLSID(16) + NumPropertySets(4) + FMTID0(16) + Offset0(4): the fixed header this package always writes and only ever reads the single-property-set form of (see read.ts's own scope note on NumPropertySets).
export const HEADER_SIZE = 48;
// [MS-OLEPS] 2.16 PropertySet: Size(4) + NumProperties(4), before the PropertyIdentifierAndOffset dictionary begins.
export const PROPERTY_SET_HEADER_SIZE = 8;
// [MS-OLEPS] 2.17 PropertyIdentifierAndOffset: PropertyIdentifier(4) + Offset(4).
export const IDENTIFIER_AND_OFFSET_SIZE = 8;
// [MS-OLEPS] 2.15 TypedPropertyValue: Type(2) + Padding(2), before the Value field.
export const TYPED_VALUE_HEADER_SIZE = 4;

// [MS-OLEPS] 2.15 PropertyType enumeration -- only the five values this package reads and/or writes (see each module's own scope note for which of read/write covers which).
export const VT_I2 = 0x0002;
export const VT_I4 = 0x0003;
export const VT_LPSTR = 0x001e;
export const VT_LPWSTR = 0x001f;
export const VT_FILETIME = 0x0040;

// [MS-OLEPS] 2.17: PID 0 is reserved for the Dictionary property (a Dictionary packet, not a TypedPropertyValue, naming string-keyed properties) -- a structure this package does not parse, and one no "\x05SummaryInformation" stream carries (only DocumentSummaryInformation's user-defined section uses named properties, which is out of scope; see the package README).
export const PID_DICTIONARY = 0;
// [MS-OLEPS] 2.18: the CodePage property, MUST be VT_I2, governing how every VT_LPSTR (CodePageString) value in the same property set decodes its bytes.
export const PID_CODEPAGE = 1;

// [MS-OLEPS] 2.19 CodePageString: when the property set's CodePage property has this value, a CodePageString is itself a UTF-16LE array rather than an ANSI one -- the codepage ./write.ts always declares, since it writes Unicode strings only.
export const CP_WINUNICODE = 1200;
// Windows Western European -- the only single-byte ANSI codepage this package's reader decodes (matching the windows-1252 convention archive-codec's own OLE Package reader, ./cfb/ole-package.ts, already uses for ANSI text), and the value the [MS-OLEPS] SummaryInformation worked example itself declares.
export const WINDOWS_1252_CODEPAGE = 1252;

// [MS-OLEPS] 2.21: "If no CLSID is provided by the application, it SHOULD be set to GUID_NULL by default" -- this package has no notion of a property set's own associated CLSID, so it always writes this and never inspects it on read.
export const GUID_NULL = "{00000000-0000-0000-0000-000000000000}";

function hex(n: number, width: number): string {
  return n.toString(16).padStart(width, "0");
}

// [MS-OLEPS] 2.7 GUID (Packet Version), reused from [MS-DTYP] 2.3.4: Data1 (4 bytes) and Data2/Data3 (2 bytes each) are little-endian; Data4 (8 bytes) is written byte-for-byte in the order the GUID's braced string form gives it, with no byte-swapping. The braced-hyphenated-uppercase-hex form is this package's own in-memory representation of a formatId (FMTID) or CLSID -- not part of the wire format itself, just how ./read.ts hands one back and ./write.ts expects one in.
export function readGuid(view: DataView, offset: number): string {
  const data1 = hex(view.getUint32(offset, true), 8);
  const data2 = hex(view.getUint16(offset + 4, true), 4);
  const data3 = hex(view.getUint16(offset + 6, true), 4);
  let data4a = "";
  for (let i = 0; i < 2; i++) {
    data4a += hex(view.getUint8(offset + 8 + i), 2);
  }
  let data4b = "";
  for (let i = 2; i < 8; i++) {
    data4b += hex(view.getUint8(offset + 8 + i), 2);
  }
  return `{${data1}-${data2}-${data3}-${data4a}-${data4b}}`.toUpperCase();
}

export function writeGuid(view: DataView, offset: number, guid: string): void {
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

// [MS-OLEPS] 2.15 (VT_FILETIME) / [MS-DTYP] 2.3.3: a FILETIME counts 100-nanosecond intervals since 1601-01-01T00:00:00Z, a JS Date counts milliseconds since 1970-01-01T00:00:00Z. The gap between those two epochs, in 100-nanosecond units -- BigInt throughout, because the raw tick count for any modern date already exceeds Number.MAX_SAFE_INTEGER.
const FILETIME_EPOCH_OFFSET_100NS = 116444736000000000n;
const HUNDRED_NS_PER_MS = 10000n;

export function filetimeToDate(low: number, high: number): Date {
  const ticks = (BigInt(high) << 32n) | BigInt(low);
  const ms = (ticks - FILETIME_EPOCH_OFFSET_100NS) / HUNDRED_NS_PER_MS;
  return new Date(Number(ms));
}

export function dateToFiletime(date: Date): {
  readonly low: number;
  readonly high: number;
} {
  const ticks =
    BigInt(date.getTime()) * HUNDRED_NS_PER_MS + FILETIME_EPOCH_OFFSET_100NS;
  return {
    low: Number(ticks & 0xffffffffn),
    high: Number((ticks >> 32n) & 0xffffffffn),
  };
}

// The typed value of one property, decoded from -- or destined for -- a TypedPropertyValue packet. Tagged by the PropertyType name rather than a synthetic kind, so a caller matching on `type` reads the same vocabulary [MS-OLEPS] itself uses.
export type PropertyValue =
  | { readonly type: "VT_I2"; readonly value: number }
  | { readonly type: "VT_I4"; readonly value: number }
  | { readonly type: "VT_LPSTR"; readonly value: string }
  | { readonly type: "VT_LPWSTR"; readonly value: string }
  | { readonly type: "VT_FILETIME"; readonly value: Date };

// One property set: its FMTID (as a formatId string) and its properties keyed by PropertyIdentifier. The vocabulary ./read.ts and ./write.ts share both directions -- reading a stream and writing one back take and return the identical shape, so a round trip is well-typed rather than a translation between two.
export interface PropertySet {
  readonly formatId: string;
  readonly properties: ReadonlyMap<number, PropertyValue>;
}
