import { describe, expect, it } from "vitest";
import {
  assertMimetypeEntryLayout,
  localFileHeaderNames,
  readUint16LE,
  readUint32LE,
} from "./zip";

const BYTE_1_SHIFT = 8;
const BYTE_2_SHIFT = 16;
const BYTE_3_SHIFT = 24;

// A zip local file header's own fixed field layout (PKWARE APPNOTE.TXT section 4.3.7), mirroring test-support/zip.ts's own private constants.
const LFH_SIGNATURE = 0x04034b50;
const LFH_COMPRESSION_METHOD_OFFSET = 8;
const LFH_COMPRESSED_SIZE_OFFSET = 18;
const LFH_FILENAME_LENGTH_OFFSET = 26;
const LFH_EXTRA_LENGTH_OFFSET = 28;
const LFH_FIXED_SIZE = 30;
const STORED_COMPRESSION_METHOD = 0;
const DEFLATED_COMPRESSION_METHOD = 8;

// Builds a single synthetic local file header (signature LFH_SIGNATURE) plus a body of `compressedSize` zero bytes, with an arbitrary filename and extra-field length, entirely by hand rather than through fflate — fflate's own zipSync never emits a non-empty extra field, so exercising the `extraLength` term in localFileHeaderNames's offset arithmetic needs bytes built directly.
function buildLocalFileHeader(
  options: Readonly<{
    filename: string;
    extraLength: number;
    compressedSize: number;
  }>,
): Uint8Array {
  const nameBytes = new TextEncoder().encode(options.filename);
  const total =
    LFH_FIXED_SIZE +
    nameBytes.length +
    options.extraLength +
    options.compressedSize;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, LFH_SIGNATURE, true);
  view.setUint16(
    LFH_COMPRESSION_METHOD_OFFSET,
    STORED_COMPRESSION_METHOD,
    true,
  );
  view.setUint32(LFH_COMPRESSED_SIZE_OFFSET, options.compressedSize, true);
  view.setUint16(LFH_FILENAME_LENGTH_OFFSET, nameBytes.length, true);
  view.setUint16(LFH_EXTRA_LENGTH_OFFSET, options.extraLength, true);
  bytes.set(nameBytes, LFH_FIXED_SIZE);
  return bytes;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

describe("readUint16LE", () => {
  // Transposing the bytes or negating the shift below would give a different value, which is the entire point of these two tests.
  const lowByte = 0x02;
  const highByte = 0x01;
  const combined16 = (highByte << BYTE_1_SHIFT) | lowByte;

  it("combines two distinct bytes little-endian", () => {
    expect(readUint16LE(new Uint8Array([lowByte, highByte]), 0)).toBe(
      combined16,
    );
  });

  it("reads from a non-zero offset (offset + 1, not offset - 1, addresses the high byte)", () => {
    const paddingByte = 0xff;
    const bytes = new Uint8Array([paddingByte, lowByte, highByte, paddingByte]);
    expect(readUint16LE(bytes, 1)).toBe(combined16);
  });

  it("throws when both bytes are missing", () => {
    expect(() => readUint16LE(new Uint8Array([]), 0)).toThrow(
      "truncated zip bytes while reading a uint16 at offset 0",
    );
  });

  it("throws when only the high byte is missing", () => {
    const arbitraryByte = 0x42;
    expect(() => readUint16LE(new Uint8Array([arbitraryByte]), 0)).toThrow(
      "truncated zip bytes while reading a uint16 at offset 0",
    );
  });

  it("throws when only the low byte is missing (negative offset)", () => {
    // offset=-1 makes bytes[-1] (the low byte) undefined while bytes[0] (the high byte) is defined.
    const arbitraryByteA = 0x42;
    const arbitraryByteB = 0x43;
    expect(() =>
      readUint16LE(new Uint8Array([arbitraryByteA, arbitraryByteB]), -1),
    ).toThrow("truncated zip bytes while reading a uint16 at offset -1");
  });

  it("reports the exact offset that failed, not a neighbouring one", () => {
    const arbitraryThirdByte = 3;
    const failingOffset = 5;
    expect(() =>
      readUint16LE(new Uint8Array([1, 2, arbitraryThirdByte]), failingOffset),
    ).toThrow(
      `truncated zip bytes while reading a uint16 at offset ${failingOffset}`,
    );
  });
});

describe("readUint32LE", () => {
  it("combines four distinct bytes little-endian, unsigned", () => {
    // (byte3 << 24) | (byte2 << 16) | (byte1 << 8) | byte0 — transposing the bytes or reordering the shifts would give a different value.
    const byte0 = 0x04;
    const byte1 = 0x03;
    const byte2 = 0x02;
    const byte3 = 0x01;
    const combined32 =
      (byte3 << BYTE_3_SHIFT) |
      (byte2 << BYTE_2_SHIFT) |
      (byte1 << BYTE_1_SHIFT) |
      byte0;
    expect(readUint32LE(new Uint8Array([byte0, byte1, byte2, byte3]), 0)).toBe(
      combined32,
    );
  });

  it("stays unsigned even when the top byte would set the sign bit", () => {
    // Without the >>> 0 conversion this would read as a negative number.
    const zeroByte = 0x00;
    const highSignBitByte = 0xff;
    expect(
      readUint32LE(
        new Uint8Array([zeroByte, zeroByte, zeroByte, highSignBitByte]),
        0,
      ),
    ).toBe((highSignBitByte << BYTE_3_SHIFT) >>> 0);
  });

  it("throws when all four bytes are missing", () => {
    expect(() => readUint32LE(new Uint8Array([]), 0)).toThrow(
      "truncated zip bytes while reading a uint32 at offset 0",
    );
  });

  it("throws when only the last byte is missing", () => {
    const arbitraryThirdByte = 3;
    expect(() =>
      readUint32LE(new Uint8Array([1, 2, arbitraryThirdByte]), 0),
    ).toThrow("truncated zip bytes while reading a uint32 at offset 0");
  });

  it("throws when only the third byte is missing", () => {
    expect(() => readUint32LE(new Uint8Array([1, 2]), 0)).toThrow(
      "truncated zip bytes while reading a uint32 at offset 0",
    );
  });

  it("throws when only the first byte is present", () => {
    expect(() => readUint32LE(new Uint8Array([1]), 0)).toThrow(
      "truncated zip bytes while reading a uint32 at offset 0",
    );
  });

  it("throws when only the first byte is missing (negative offset)", () => {
    // offset=-1 makes bytes[-1] (b0) undefined while b1..b3 (bytes[0..2]) are defined.
    const arbitraryThirdByte = 3;
    expect(() =>
      readUint32LE(new Uint8Array([1, 2, arbitraryThirdByte]), -1),
    ).toThrow("truncated zip bytes while reading a uint32 at offset -1");
  });
});

describe("localFileHeaderNames", () => {
  it("returns no names for an empty byte array", () => {
    expect(localFileHeaderNames(new Uint8Array([]))).toEqual([]);
  });

  it("stops cleanly when the walk consumes every byte exactly (no off-by-one past the end)", () => {
    const header = buildLocalFileHeader({
      filename: "a.txt",
      extraLength: 0,
      compressedSize: 0,
    });
    expect(localFileHeaderNames(header)).toEqual(["a.txt"]);
  });

  it("walks past a non-zero extra field to find the next header", () => {
    const first = buildLocalFileHeader({
      filename: "first.xml",
      extraLength: 4,
      compressedSize: 0,
    });
    const second = buildLocalFileHeader({
      filename: "second.xml",
      extraLength: 0,
      compressedSize: 0,
    });
    const bytes = concatBytes([first, second]);
    expect(localFileHeaderNames(bytes)).toEqual(["first.xml", "second.xml"]);
  });

  it("walks past a non-zero compressed size to find the next header", () => {
    const first = buildLocalFileHeader({
      filename: "first.xml",
      extraLength: 0,
      compressedSize: 6,
    });
    const second = buildLocalFileHeader({
      filename: "second.xml",
      extraLength: 0,
      compressedSize: 0,
    });
    const bytes = concatBytes([first, second]);
    expect(localFileHeaderNames(bytes)).toEqual(["first.xml", "second.xml"]);
  });

  it("walks past both a non-zero extra field and compressed size together", () => {
    const first = buildLocalFileHeader({
      filename: "first.xml",
      extraLength: 3,
      compressedSize: 5,
    });
    const second = buildLocalFileHeader({
      filename: "second.xml",
      extraLength: 0,
      compressedSize: 0,
    });
    const third = buildLocalFileHeader({
      filename: "third.xml",
      extraLength: 0,
      compressedSize: 0,
    });
    const bytes = concatBytes([first, second, third]);
    expect(localFileHeaderNames(bytes)).toEqual([
      "first.xml",
      "second.xml",
      "third.xml",
    ]);
  });

  it("stops at the first entry whose signature does not match, without reading past it", () => {
    const header = buildLocalFileHeader({
      filename: "only.xml",
      extraLength: 0,
      compressedSize: 0,
    });
    // A central directory record signature ("PK\x01\x02"), not a local file header.
    const CENTRAL_DIRECTORY_SIGNATURE_PREFIX: readonly number[] = Array.from(
      "PK",
      (c) => c.charCodeAt(0),
    );
    const trailer = new Uint8Array([
      ...CENTRAL_DIRECTORY_SIGNATURE_PREFIX,
      1,
      2,
    ]);
    const bytes = concatBytes([header, trailer]);
    expect(localFileHeaderNames(bytes)).toEqual(["only.xml"]);
  });
});

describe("assertMimetypeEntryLayout", () => {
  const mediaType = "application/vnd.oasis.opendocument.text";
  const mimetypeFilename = "mimetype";

  function validLayout(): Uint8Array {
    // Header only, then the content bytes appended below.
    return buildLocalFileHeader({
      filename: mimetypeFilename,
      extraLength: 0,
      compressedSize: 0,
    }).slice(0, LFH_FIXED_SIZE + mimetypeFilename.length);
  }

  function withMimetypeContent(content: string): Uint8Array {
    const header = validLayout();
    return concatBytes([header, new TextEncoder().encode(content)]);
  }

  it("accepts a correctly-laid-out mimetype entry", () => {
    expect(() => {
      assertMimetypeEntryLayout(withMimetypeContent(mediaType), mediaType);
    }).not.toThrow();
  });

  it("rejects a wrong local file header signature", () => {
    const bytes = withMimetypeContent(mediaType);
    bytes[0] = 0x00;
    expect(() => {
      assertMimetypeEntryLayout(bytes, mediaType);
    }).toThrow(/local file header signature/);
  });

  it("rejects a non-zero compression method", () => {
    const bytes = withMimetypeContent(mediaType);
    bytes[LFH_COMPRESSION_METHOD_OFFSET] = DEFLATED_COMPRESSION_METHOD; // DEFLATE, not stored
    expect(() => {
      assertMimetypeEntryLayout(bytes, mediaType);
    }).toThrow(/compression method/);
  });

  it("rejects a filename length other than 8", () => {
    const bytes = buildLocalFileHeader({
      filename: "mimetype2",
      extraLength: 0,
      compressedSize: 0,
    });
    expect(() => {
      assertMimetypeEntryLayout(bytes, mediaType);
    }).toThrow(/filename length/);
  });

  it("rejects a non-zero extra field length", () => {
    const bytes = buildLocalFileHeader({
      filename: "mimetype",
      extraLength: 4,
      compressedSize: 0,
    });
    expect(() => {
      assertMimetypeEntryLayout(bytes, mediaType);
    }).toThrow(/extra field length/);
  });

  it("rejects filename bytes other than the literal string mimetype", () => {
    const bytes = buildLocalFileHeader({
      filename: "MIMETYPE",
      extraLength: 0,
      compressedSize: 0,
    });
    expect(() => {
      assertMimetypeEntryLayout(bytes, mediaType);
    }).toThrow(/filename bytes/);
  });

  it("rejects mimetype content bytes that don't match the given media type", () => {
    const bytes = withMimetypeContent(
      "application/vnd.oasis.opendocument.spreadsheet",
    );
    expect(() => {
      assertMimetypeEntryLayout(bytes, mediaType);
    }).toThrow(/mimetype content bytes/);
  });
});
