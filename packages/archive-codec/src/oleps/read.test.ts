import { describe, expect, it } from "vitest";
import { propertySetStream } from "../test-support/oleps";
import {
  PropertySetFormatError,
  decodeCodepage,
  readPropertySetStream,
  truncateAtNull,
} from "./read";
import {
  HEADER_SIZE,
  IDENTIFIER_AND_OFFSET_SIZE,
  PROPERTY_SET_HEADER_SIZE,
  TYPED_VALUE_HEADER_SIZE,
} from "./wire";

// Coverage for the generic [MS-OLEPS] Property Set Stream reader (src/oleps/read.ts). The primary fixture below is transcribed byte-for-byte from [MS-OLEPS]'s own worked "SummaryInformation Property Set" example (the stream contents table in the spec's SummaryInformation Property Set section) -- the strongest possible validation, since it proves this reader parses a real, complete, unmodified 444-byte stream a genuine implementation produced, not merely bytes this reader's own writer happens to agree with itself about. It exercises every property type this reader supports (VT_I2 for CodePage, VT_LPSTR for every string property, VT_FILETIME for every timestamp, VT_I4 for every count) in one pass. Additional fixtures below it, built via ../test-support/oleps.ts (independent of ./write.ts's own construction), cover round-trip correctness for values this reader's own numbers can be hand-verified against, and the structural error paths.

const FMTID_SUMMARY_INFORMATION = "{F29F85E0-4FF9-1068-AB91-08002B27B3D9}";

// propertySetStream always writes Offset0 = HEADER_SIZE and a genuine PropertySet packet Size covering everything it built, so truncating the array alone to test a check deeper than that declared Size always trips the Size check itself first (it runs earlier in readPropertySetStream, and any truncation short of the packet's true end is also short of its declared Size, which describes that same true end). Corrupting the Size field down to 0 -- nothing else in this reader ever reads it again -- lets the array's own physical truncation reach a boundary further in without the Size check intercepting it.
function truncatedPastDeclaredSize(
  full: Uint8Array<ArrayBuffer>,
  length: number,
): Uint8Array<ArrayBuffer> {
  const bytes = full.subarray(0, length);
  new DataView(bytes.buffer).setUint32(HEADER_SIZE, 0, true);
  return bytes;
}

// prettier-ignore
const SUMMARY_INFORMATION_WORKED_EXAMPLE = new Uint8Array([
  // 00x
  0xfe, 0xff, 0x00, 0x00, 0x06, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  // 01x
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0xe0, 0x85, 0x9f, 0xf2,
  // 02x
  0xf9, 0x4f, 0x68, 0x10, 0xab, 0x91, 0x08, 0x00, 0x2b, 0x27, 0xb3, 0xd9, 0x30, 0x00, 0x00, 0x00,
  // 03x
  0x8c, 0x01, 0x00, 0x00, 0x12, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x98, 0x00, 0x00, 0x00,
  // 04x
  0x02, 0x00, 0x00, 0x00, 0xa0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0xb8, 0x00, 0x00, 0x00,
  // 05x
  0x04, 0x00, 0x00, 0x00, 0xc4, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0xd0, 0x00, 0x00, 0x00,
  // 06x
  0x06, 0x00, 0x00, 0x00, 0xdc, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0xe8, 0x00, 0x00, 0x00,
  // 07x
  0x08, 0x00, 0x00, 0x00, 0xfc, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x10, 0x01, 0x00, 0x00,
  // 08x
  0x12, 0x00, 0x00, 0x00, 0x1c, 0x01, 0x00, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x3c, 0x01, 0x00, 0x00,
  // 09x
  0x0b, 0x00, 0x00, 0x00, 0x48, 0x01, 0x00, 0x00, 0x0c, 0x00, 0x00, 0x00, 0x54, 0x01, 0x00, 0x00,
  // 0Ax
  0x0d, 0x00, 0x00, 0x00, 0x60, 0x01, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x6c, 0x01, 0x00, 0x00,
  // 0Bx
  0x0f, 0x00, 0x00, 0x00, 0x74, 0x01, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x7c, 0x01, 0x00, 0x00,
  // 0Cx
  0x13, 0x00, 0x00, 0x00, 0x84, 0x01, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0xe4, 0x04, 0x00, 0x00,
  // 0Dx
  0x1e, 0x00, 0x00, 0x00, 0x0f, 0x00, 0x00, 0x00, 0x4a, 0x6f, 0x65, 0x27, 0x73, 0x20, 0x64, 0x6f,
  // 0Ex
  0x63, 0x75, 0x6d, 0x65, 0x6e, 0x74, 0x00, 0x00, 0x1e, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00,
  // 0Fx
  0x4a, 0x6f, 0x62, 0x00, 0x1e, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x4a, 0x6f, 0x65, 0x00,
  // 10x
  0x1e, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1e, 0x00, 0x00, 0x00,
  // 11x
  0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1e, 0x00, 0x00, 0x00, 0x0c, 0x00, 0x00, 0x00,
  // 12x
  0x4e, 0x6f, 0x72, 0x6d, 0x61, 0x6c, 0x2e, 0x64, 0x6f, 0x74, 0x6d, 0x00, 0x1e, 0x00, 0x00, 0x00,
  // 13x
  0x0a, 0x00, 0x00, 0x00, 0x43, 0x6f, 0x72, 0x6e, 0x65, 0x6c, 0x69, 0x75, 0x73, 0x00, 0x00, 0x00,
  // 14x
  0x1e, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x36, 0x36, 0x00, 0x00, 0x1e, 0x00, 0x00, 0x00,
  // 15x
  0x18, 0x00, 0x00, 0x00, 0x4d, 0x69, 0x63, 0x72, 0x6f, 0x73, 0x6f, 0x66, 0x74, 0x20, 0x4f, 0x66,
  // 16x
  0x66, 0x69, 0x63, 0x65, 0x20, 0x57, 0x6f, 0x72, 0x64, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00,
  // 17x
  0x00, 0x6e, 0xd9, 0xa2, 0x42, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x16, 0xd0, 0xa1,
  // 18x
  0x4e, 0x8e, 0xc6, 0x01, 0x40, 0x00, 0x00, 0x00, 0x00, 0x1c, 0xf2, 0xd5, 0x2a, 0xce, 0xc6, 0x01,
  // 19x
  0x40, 0x00, 0x00, 0x00, 0x00, 0x3c, 0xdc, 0x73, 0xdd, 0x80, 0xc8, 0x01, 0x03, 0x00, 0x00, 0x00,
  // 1Ax
  0x0e, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0xe5, 0x0d, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00,
  // 1Bx (only 12 bytes: the stream ends at offset 0x1BC)
  0x38, 0x4f, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

// 100-nanosecond intervals since 1601-01-01T00:00:00Z to 1970-01-01T00:00:00Z -- reimplemented independently here (rather than imported from ./wire.ts) so this expected-value derivation genuinely checks the reader's output against the documented [MS-OLEPS]/[MS-DTYP] FILETIME formula, not against this package's own conversion.
function expectedFiletimeIso(low: bigint, high: bigint): string {
  const ticks = (high << 32n) | low;
  const ms = (ticks - 116444736000000000n) / 10000n;
  return new Date(Number(ms)).toISOString();
}

describe("readPropertySetStream", () => {
  it("parses [MS-OLEPS]'s own worked SummaryInformation Property Set example in full", () => {
    const propertySet = readPropertySetStream(
      SUMMARY_INFORMATION_WORKED_EXAMPLE,
    );
    expect(propertySet.formatId).toBe(FMTID_SUMMARY_INFORMATION);
    expect(propertySet.properties.size).toBe(18);

    expect(propertySet.properties.get(1)).toEqual({
      type: "VT_I2",
      value: 1252,
    }); // PID_CODEPAGE
    expect(propertySet.properties.get(2)).toEqual({
      type: "VT_LPSTR",
      value: "Joe's document",
    }); // PIDSI_TITLE
    expect(propertySet.properties.get(3)).toEqual({
      type: "VT_LPSTR",
      value: "Job",
    }); // PIDSI_SUBJECT
    expect(propertySet.properties.get(4)).toEqual({
      type: "VT_LPSTR",
      value: "Joe",
    }); // PIDSI_AUTHOR
    expect(propertySet.properties.get(5)).toEqual({
      type: "VT_LPSTR",
      value: "",
    }); // PIDSI_KEYWORDS
    expect(propertySet.properties.get(6)).toEqual({
      type: "VT_LPSTR",
      value: "",
    }); // PIDSI_COMMENTS
    expect(propertySet.properties.get(7)).toEqual({
      type: "VT_LPSTR",
      value: "Normal.dotm",
    }); // PIDSI_TEMPLATE
    expect(propertySet.properties.get(8)).toEqual({
      type: "VT_LPSTR",
      value: "Cornelius",
    }); // PIDSI_LASTAUTHOR
    expect(propertySet.properties.get(9)).toEqual({
      type: "VT_LPSTR",
      value: "66",
    }); // PIDSI_REVNUMBER
    expect(propertySet.properties.get(0x12)).toEqual({
      type: "VT_LPSTR",
      value: "Microsoft Office Word",
    }); // PIDSI_APPNAME

    expect(propertySet.properties.get(14)).toEqual({
      type: "VT_I4",
      value: 14,
    }); // PIDSI_PAGECOUNT
    expect(propertySet.properties.get(15)).toEqual({
      type: "VT_I4",
      value: 3557,
    }); // PIDSI_WORDCOUNT
    expect(propertySet.properties.get(16)).toEqual({
      type: "VT_I4",
      value: 20280,
    }); // PIDSI_CHARCOUNT
    expect(propertySet.properties.get(0x13)).toEqual({
      type: "VT_I4",
      value: 0,
    }); // PIDSI_DOC_SECURITY

    const lastPrinted = propertySet.properties.get(11); // PIDSI_LASTPRINTED
    expect(lastPrinted?.type).toBe("VT_FILETIME");
    expect((lastPrinted?.value as Date).toISOString()).toBe(
      expectedFiletimeIso(0xa1d01600n, 0x01c68e4en),
    );

    const created = propertySet.properties.get(12); // PIDSI_CREATE_DTM
    expect(created?.type).toBe("VT_FILETIME");
    expect((created?.value as Date).toISOString()).toBe(
      expectedFiletimeIso(0xd5f21c00n, 0x01c6ce2an),
    );

    const lastSaved = propertySet.properties.get(13); // PIDSI_LASTSAVE_DTM
    expect(lastSaved?.type).toBe("VT_FILETIME");
    expect((lastSaved?.value as Date).toISOString()).toBe(
      expectedFiletimeIso(0x73dc3c00n, 0x01c880ddn),
    );
  });

  it("round-trips a hand-built VT_LPWSTR (Unicode) string property with CP_WINUNICODE declared", () => {
    const bytes = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 1, value: { type: "VT_I2", value: 1200 } },
      { pid: 2, value: { type: "VT_LPWSTR", value: "Café Über" } },
    ]);
    const propertySet = readPropertySetStream(bytes);
    expect(propertySet.properties.get(2)).toEqual({
      type: "VT_LPWSTR",
      value: "Café Über",
    });
  });

  it("decodes a VT_LPSTR (CodePageString) as UTF-16LE when CodePage declares CP_WINUNICODE", () => {
    // A CodePageString's own encoding follows the CodePage property, not its own type tag: with CP_WINUNICODE declared, VT_LPSTR becomes a UTF-16LE array too ([MS-OLEPS] 2.19).
    const bytes = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 1, value: { type: "VT_I2", value: 1200 } },
      { pid: 2, value: { type: "VT_LPSTR_UTF16", value: "Café Über" } },
    ]);
    expect(readPropertySetStream(bytes).properties.get(2)).toEqual({
      type: "VT_LPSTR",
      value: "Café Über",
    });
  });

  it("decodes a VT_LPSTR (CodePageString) as windows-1252 when CodePage is absent", () => {
    const bytes = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_LPSTR", value: "plain title" } },
    ]);
    expect(readPropertySetStream(bytes).properties.get(2)).toEqual({
      type: "VT_LPSTR",
      value: "plain title",
    });
  });

  it("skips a VT_LPSTR under a CodePage this reader does not decode, rather than throwing", () => {
    const bytes = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 1, value: { type: "VT_I2", value: 932 } }, // Shift-JIS -- neither CP_WINUNICODE nor windows-1252
      { pid: 2, value: { type: "VT_LPSTR", value: "x" } },
    ]);
    const propertySet = readPropertySetStream(bytes);
    expect(propertySet.properties.has(2)).toBe(false);
    expect(propertySet.properties.get(1)).toEqual({
      type: "VT_I2",
      value: 932,
    });
  });

  it("throws PropertySetFormatError for a ByteOrder field other than 0xFFFE", () => {
    const bytes = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_LPWSTR", value: "x" } },
    ]);
    bytes.set([0x00, 0x00], 0);
    expect(() => readPropertySetStream(bytes)).toThrow(PropertySetFormatError);
  });

  it("throws PropertySetFormatError for NumPropertySets other than 1", () => {
    const bytes = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_LPWSTR", value: "x" } },
    ]);
    const view = new DataView(bytes.buffer);
    view.setUint32(24, 2, true);
    expect(() => readPropertySetStream(bytes)).toThrow(PropertySetFormatError);
  });

  it("throws PropertySetFormatError for a Dictionary property (PID 0)", () => {
    const bytes = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 0, value: { type: "VT_LPWSTR", value: "x" } },
    ]);
    expect(() => readPropertySetStream(bytes)).toThrow(PropertySetFormatError);
  });

  it("skips a property type this reader does not decode, rather than throwing", () => {
    const bytes = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_I4", value: 1 } },
    ]);
    const view = new DataView(bytes.buffer);
    // The dictionary/value pair are already well-formed for VT_I4; corrupt the Type field alone to an unsupported code (VT_BOOL, 0x000B) without touching the value bytes.
    view.setUint16(48 + 8 + 8, 0x000b, true);
    const propertySet = readPropertySetStream(bytes);
    expect(propertySet.properties.has(2)).toBe(false);
  });

  it("returns every decodable property when an undecodable one (e.g. a VT_CF thumbnail) sits among them, rather than aborting the whole read", () => {
    // PIDSI_THUMBNAIL (PID 0x11) is VT_CF in a real SummaryInformation stream, a type this reader does not decode -- Word/Excel/PowerPoint write one whenever "save preview picture" is on. Built as VT_I4 (the test-support encoder has no VT_CF case) then the Type field alone is corrupted to VT_CF's real code, 0x0047, leaving PID 2's own decodable property untouched -- the exact scenario the HIGH-severity review finding names: an unsupported type must not abort a read that also carries properties this reader can decode.
    const bytes = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_LPWSTR", value: "Joe's document" } },
      { pid: 0x11, value: { type: "VT_I4", value: 0 } },
      { pid: 4, value: { type: "VT_LPWSTR", value: "Joe" } },
    ]);
    const view = new DataView(bytes.buffer);
    // PID 0x11 is the dictionary's second entry (index 1); read its own relativeOffset back out rather than hand-deriving the byte length of PID 2's preceding VT_LPWSTR value.
    const dictionaryEntryOffset =
      HEADER_SIZE + PROPERTY_SET_HEADER_SIZE + 1 * IDENTIFIER_AND_OFFSET_SIZE;
    const relativeOffset = view.getUint32(dictionaryEntryOffset + 4, true);
    view.setUint16(HEADER_SIZE + relativeOffset, 0x0047, true); // VT_CF
    const propertySet = readPropertySetStream(bytes);
    expect(propertySet.properties.get(2)).toEqual({
      type: "VT_LPWSTR",
      value: "Joe's document",
    });
    expect(propertySet.properties.get(4)).toEqual({
      type: "VT_LPWSTR",
      value: "Joe",
    });
    expect(propertySet.properties.has(0x11)).toBe(false);
  });

  it("throws naming the PropertySetStream header's own required size when the stream is shorter than it", () => {
    const bytes = new Uint8Array(HEADER_SIZE - 1);
    expect(() => readPropertySetStream(bytes)).toThrow(
      `property set stream ends before the PropertySetStream header (needs ${HEADER_SIZE} bytes at offset 0, stream is ${HEADER_SIZE - 1} bytes)`,
    );
  });

  it("throws naming the exact ByteOrder value found, in hex, for a ByteOrder field other than 0xFFFE", () => {
    const bytes = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_LPWSTR", value: "x" } },
    ]);
    bytes.set([0x34, 0x12], 0); // 0x1234 little-endian -- a value distinguishable from its own byte-swapped reading, unlike an all-zero or palindromic one
    expect(() => readPropertySetStream(bytes)).toThrow(
      "property set stream's ByteOrder field is 0x1234, not the mandated 0xFFFE",
    );
  });

  it("names its own error class PropertySetFormatError, not merely an instance of it", () => {
    const bytes = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_LPWSTR", value: "x" } },
    ]);
    bytes.set([0x34, 0x12], 0);
    let caught: unknown;
    try {
      readPropertySetStream(bytes);
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).name).toBe("PropertySetFormatError");
  });

  it("throws naming the exact declared count for NumPropertySets other than 1", () => {
    const bytes = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_LPWSTR", value: "x" } },
    ]);
    const view = new DataView(bytes.buffer);
    view.setUint32(24, 2, true);
    expect(() => readPropertySetStream(bytes)).toThrow(
      'property set stream declares 2 property sets; this reader only handles the single-property-set form every "\\x05SummaryInformation" stream uses (the two-property-set DocumentSummaryInformation/UserDefinedProperties spelling is out of scope, see the package README)',
    );
  });

  it("throws its exact message for a Dictionary property (PID 0)", () => {
    const bytes = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 0, value: { type: "VT_LPWSTR", value: "x" } },
    ]);
    expect(() => readPropertySetStream(bytes)).toThrow(
      'property set carries a Dictionary property (PID 0), which names string-keyed properties this reader does not support -- no "\\x05SummaryInformation" stream should carry one',
    );
  });

  it("throws naming the PropertySet packet header's own required size when the packet header doesn't fit", () => {
    const full = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_I4", value: 1 } },
    ]);
    const truncatedLength = HEADER_SIZE + PROPERTY_SET_HEADER_SIZE - 1;
    const bytes = full.subarray(0, truncatedLength);
    expect(() => readPropertySetStream(bytes)).toThrow(
      `property set stream ends before the PropertySet packet header (needs ${PROPERTY_SET_HEADER_SIZE} bytes at offset ${HEADER_SIZE}, stream is ${truncatedLength} bytes)`,
    );
  });

  it("throws naming the PropertySet packet's own declared Size when the stream ends before it", () => {
    const full = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_I4", value: 1 } },
    ]);
    // The stream's total length is exactly offset0 + the declared Size (HEADER_SIZE, since propertySetStream always writes Offset0 as HEADER_SIZE, plus the PropertySet packet's own bytes) -- one byte short of that is one byte short of the declared Size fitting.
    const truncatedLength = full.length - 1;
    const bytes = full.subarray(0, truncatedLength);
    const declaredSize = new DataView(full.buffer).getUint32(HEADER_SIZE, true);
    expect(() => readPropertySetStream(bytes)).toThrow(
      `property set stream ends before the PropertySet packet's own declared Size (needs ${declaredSize} bytes at offset ${HEADER_SIZE}, stream is ${truncatedLength} bytes)`,
    );
  });

  it("throws naming the PropertyIdentifierAndOffset dictionary's own required size when it doesn't fit", () => {
    const full = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_I4", value: 1 } },
    ]);
    const tableStart = HEADER_SIZE + PROPERTY_SET_HEADER_SIZE;
    const dictionaryLength = 1 * IDENTIFIER_AND_OFFSET_SIZE;
    const truncatedLength = tableStart + dictionaryLength - 1;
    const bytes = truncatedPastDeclaredSize(full, truncatedLength);
    expect(() => readPropertySetStream(bytes)).toThrow(
      `property set stream ends before the PropertyIdentifierAndOffset dictionary (needs ${dictionaryLength} bytes at offset ${tableStart}, stream is ${truncatedLength} bytes)`,
    );
  });

  it("throws naming the CodePage property's own TypedPropertyValue size when it doesn't fit", () => {
    const full = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 1, value: { type: "VT_I2", value: 1252 } },
    ]);
    const abs =
      HEADER_SIZE + PROPERTY_SET_HEADER_SIZE + IDENTIFIER_AND_OFFSET_SIZE;
    const requiredLength = TYPED_VALUE_HEADER_SIZE + 4;
    const truncatedLength = abs + requiredLength - 1;
    const bytes = truncatedPastDeclaredSize(full, truncatedLength);
    expect(() => readPropertySetStream(bytes)).toThrow(
      `property set stream ends before the CodePage property's TypedPropertyValue (needs ${requiredLength} bytes at offset ${abs}, stream is ${truncatedLength} bytes)`,
    );
  });

  it("throws naming the exact type code found, in hex, when the CodePage property is not VT_I2", () => {
    const bytes = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 1, value: { type: "VT_I4", value: 1252 } },
    ]);
    expect(() => readPropertySetStream(bytes)).toThrow(
      "CodePage property (PID 1) has type 0x3, not VT_I2 as [MS-OLEPS] requires",
    );
  });

  it("throws naming a property's own TypedPropertyValue header size when it doesn't fit", () => {
    const full = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_I4", value: 1 } },
    ]);
    const abs =
      HEADER_SIZE + PROPERTY_SET_HEADER_SIZE + IDENTIFIER_AND_OFFSET_SIZE;
    const truncatedLength = abs + TYPED_VALUE_HEADER_SIZE - 1;
    const bytes = truncatedPastDeclaredSize(full, truncatedLength);
    expect(() => readPropertySetStream(bytes)).toThrow(
      `property set stream ends before a property's TypedPropertyValue header (needs ${TYPED_VALUE_HEADER_SIZE} bytes at offset ${abs}, stream is ${truncatedLength} bytes)`,
    );
  });

  it("throws naming the exact padding value found, in hex, decoded little-endian, when TypedPropertyValue padding is non-zero", () => {
    const full = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_I4", value: 1 } },
    ]);
    const abs =
      HEADER_SIZE + PROPERTY_SET_HEADER_SIZE + IDENTIFIER_AND_OFFSET_SIZE;
    // Two distinct, non-zero bytes: little-endian and big-endian readings of them produce different numbers (0x3412 vs 0x1234), so asserting the exact hex value in the message proves the padding is decoded in the byte order [MS-OLEPS] uses everywhere else, not merely checked against zero.
    const bytes = full.subarray();
    new DataView(bytes.buffer).setUint16(abs + 2, 0x1234, true);
    expect(() => readPropertySetStream(bytes)).toThrow(
      "property 2's TypedPropertyValue padding is 0x1234, not zero as [MS-OLEPS] requires",
    );
  });

  it("throws naming the VT_I2 value's own required size when it doesn't fit", () => {
    const full = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_I2", value: 1 } },
    ]);
    const valueOffset =
      HEADER_SIZE +
      PROPERTY_SET_HEADER_SIZE +
      IDENTIFIER_AND_OFFSET_SIZE +
      TYPED_VALUE_HEADER_SIZE;
    const truncatedLength = valueOffset + 4 - 1;
    const bytes = truncatedPastDeclaredSize(full, truncatedLength);
    expect(() => readPropertySetStream(bytes)).toThrow(
      `property set stream ends before property 2's VT_I2 value (needs 4 bytes at offset ${valueOffset}, stream is ${truncatedLength} bytes)`,
    );
  });

  it("throws naming the VT_I4 value's own required size when it doesn't fit", () => {
    const full = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_I4", value: 1 } },
    ]);
    const valueOffset =
      HEADER_SIZE +
      PROPERTY_SET_HEADER_SIZE +
      IDENTIFIER_AND_OFFSET_SIZE +
      TYPED_VALUE_HEADER_SIZE;
    const truncatedLength = valueOffset + 4 - 1;
    const bytes = truncatedPastDeclaredSize(full, truncatedLength);
    expect(() => readPropertySetStream(bytes)).toThrow(
      `property set stream ends before property 2's VT_I4 value (needs 4 bytes at offset ${valueOffset}, stream is ${truncatedLength} bytes)`,
    );
  });

  it("throws naming the VT_FILETIME value's own required size when it doesn't fit", () => {
    const full = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 12, value: { type: "VT_FILETIME", low: 0, high: 0 } },
    ]);
    const valueOffset =
      HEADER_SIZE +
      PROPERTY_SET_HEADER_SIZE +
      IDENTIFIER_AND_OFFSET_SIZE +
      TYPED_VALUE_HEADER_SIZE;
    const truncatedLength = valueOffset + 8 - 1;
    const bytes = truncatedPastDeclaredSize(full, truncatedLength);
    expect(() => readPropertySetStream(bytes)).toThrow(
      `property set stream ends before property 12's VT_FILETIME value (needs 8 bytes at offset ${valueOffset}, stream is ${truncatedLength} bytes)`,
    );
  });

  it("throws naming a CodePageString's own Size field size when it doesn't fit", () => {
    const full = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_LPSTR", value: "x" } },
    ]);
    const valueOffset =
      HEADER_SIZE +
      PROPERTY_SET_HEADER_SIZE +
      IDENTIFIER_AND_OFFSET_SIZE +
      TYPED_VALUE_HEADER_SIZE;
    const truncatedLength = valueOffset + 4 - 1;
    const bytes = truncatedPastDeclaredSize(full, truncatedLength);
    expect(() => readPropertySetStream(bytes)).toThrow(
      `property set stream ends before a CodePageString's Size field (needs 4 bytes at offset ${valueOffset}, stream is ${truncatedLength} bytes)`,
    );
  });

  it("throws naming a CodePageString's own Characters field size when it doesn't fit", () => {
    const full = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_LPSTR", value: "x" } }, // Size = "x".length + 1 = 2
    ]);
    const valueOffset =
      HEADER_SIZE +
      PROPERTY_SET_HEADER_SIZE +
      IDENTIFIER_AND_OFFSET_SIZE +
      TYPED_VALUE_HEADER_SIZE;
    const charactersOffset = valueOffset + 4;
    const truncatedLength = charactersOffset + 2 - 1;
    const bytes = truncatedPastDeclaredSize(full, truncatedLength);
    expect(() => readPropertySetStream(bytes)).toThrow(
      `property set stream ends before a CodePageString's Characters field (needs 2 bytes at offset ${charactersOffset}, stream is ${truncatedLength} bytes)`,
    );
  });

  it("throws naming a UnicodeString's own Length field size when it doesn't fit", () => {
    const full = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_LPWSTR", value: "x" } },
    ]);
    const valueOffset =
      HEADER_SIZE +
      PROPERTY_SET_HEADER_SIZE +
      IDENTIFIER_AND_OFFSET_SIZE +
      TYPED_VALUE_HEADER_SIZE;
    const truncatedLength = valueOffset + 4 - 1;
    const bytes = truncatedPastDeclaredSize(full, truncatedLength);
    expect(() => readPropertySetStream(bytes)).toThrow(
      `property set stream ends before a UnicodeString's Length field (needs 4 bytes at offset ${valueOffset}, stream is ${truncatedLength} bytes)`,
    );
  });

  it("throws naming a UnicodeString's own Characters field size when it doesn't fit", () => {
    const full = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 2, value: { type: "VT_LPWSTR", value: "x" } }, // Length (16-bit units) = "x".length + 1 = 2, so Characters is 4 bytes
    ]);
    const valueOffset =
      HEADER_SIZE +
      PROPERTY_SET_HEADER_SIZE +
      IDENTIFIER_AND_OFFSET_SIZE +
      TYPED_VALUE_HEADER_SIZE;
    const charactersOffset = valueOffset + 4;
    const truncatedLength = charactersOffset + 4 - 1;
    const bytes = truncatedPastDeclaredSize(full, truncatedLength);
    expect(() => readPropertySetStream(bytes)).toThrow(
      `property set stream ends before a UnicodeString's Characters field (needs 4 bytes at offset ${charactersOffset}, stream is ${truncatedLength} bytes)`,
    );
  });
});

describe("decodeCodepage", () => {
  it("returns a non-negative raw value unchanged, including exactly zero", () => {
    expect(decodeCodepage(0)).toBe(0);
    expect(decodeCodepage(1252)).toBe(1252);
    expect(decodeCodepage(32767)).toBe(32767);
  });

  it("adds 0x10000 to a negative raw value, recovering the unsigned codepage a real producer declared", () => {
    expect(decodeCodepage(-1)).toBe(0xffff);
    expect(decodeCodepage(-32768)).toBe(0x8000);
  });
});

describe("truncateAtNull", () => {
  it("returns the value unchanged when it carries no null code unit at all", () => {
    expect(truncateAtNull("no null here")).toBe("no null here");
  });

  it("returns an empty string when the null is the very first code unit", () => {
    expect(truncateAtNull(" trailing garbage")).toBe("");
  });

  it("truncates at a null code unit in the middle, dropping everything from it onward", () => {
    expect(truncateAtNull("kept dropped")).toBe("kept");
  });
});
