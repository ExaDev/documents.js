import { describe, expect, it } from "vitest";
import {
  assertMimetypeEntryLayout,
  definedByte,
  localFileHeaderNames,
  MIMETYPE_ENTRY_NAME,
  readUint16LE,
  readUint32LE,
  ZIP_COMPRESSED_SIZE_OFFSET,
  ZIP_COMPRESSION_METHOD_OFFSET,
  ZIP_EXTRA_FIELD_LENGTH_OFFSET,
  ZIP_FILENAME_LENGTH_OFFSET,
  ZIP_LOCAL_FILE_HEADER_SIZE,
  ZIP_SIGNATURE_K,
  ZIP_SIGNATURE_LOCAL_FILE_HEADER,
  ZIP_SIGNATURE_LOCAL_FILE_MARKER,
  ZIP_SIGNATURE_P,
} from "./zip";

const BITS_PER_BYTE = 8;
const TWO_BYTES_BITS = 16;
const THREE_BYTES_BITS = 24;
const FOURTH_BYTE_INDEX = 3;
const BYTE_MASK = 0xff;

describe("definedByte", () => {
  it("returns the value unchanged when it is a real byte", () => {
    const arbitraryByte = 42;
    expect(definedByte(arbitraryByte)).toBe(arbitraryByte);
  });

  it("throws when the value is undefined", () => {
    expect(() => definedByte(undefined)).toThrow(
      "unreachable: expected a byte already known to be defined",
    );
  });
});

// A local file header's own fixed-position fields this module's readers walk: signature, then a run of fields irrelevant to these helpers up to compressed size, filename length, extra field length, the filename itself starting right after the fixed part, then the extra field, then the compressed data.
function buildLocalFileHeader(
  name: string,
  options: {
    readonly extraLength?: number;
    readonly compressedSize?: number;
  } = {},
): number[] {
  const nameBytes = Array.from(new TextEncoder().encode(name));
  const extraLength = options.extraLength ?? 0;
  const compressedSize = options.compressedSize ?? 0;
  const header: number[] = new Array<number>(ZIP_LOCAL_FILE_HEADER_SIZE).fill(
    0,
  );
  header[0] = ZIP_SIGNATURE_P;
  header[1] = ZIP_SIGNATURE_K;
  header[2] = ZIP_SIGNATURE_LOCAL_FILE_MARKER;
  header[3] = ZIP_SIGNATURE_LOCAL_FILE_HEADER;
  header[ZIP_COMPRESSED_SIZE_OFFSET] = compressedSize & BYTE_MASK;
  header[ZIP_COMPRESSED_SIZE_OFFSET + 1] =
    (compressedSize >> BITS_PER_BYTE) & BYTE_MASK;
  header[ZIP_COMPRESSED_SIZE_OFFSET + 2] =
    (compressedSize >> TWO_BYTES_BITS) & BYTE_MASK;
  header[ZIP_COMPRESSED_SIZE_OFFSET + FOURTH_BYTE_INDEX] =
    (compressedSize >> THREE_BYTES_BITS) & BYTE_MASK;
  header[ZIP_FILENAME_LENGTH_OFFSET] = nameBytes.length & BYTE_MASK;
  header[ZIP_FILENAME_LENGTH_OFFSET + 1] =
    (nameBytes.length >> BITS_PER_BYTE) & BYTE_MASK;
  header[ZIP_EXTRA_FIELD_LENGTH_OFFSET] = extraLength & BYTE_MASK;
  header[ZIP_EXTRA_FIELD_LENGTH_OFFSET + 1] =
    (extraLength >> BITS_PER_BYTE) & BYTE_MASK;
  const extraBytes: number[] = new Array<number>(extraLength).fill(0);
  const compressedBytes: number[] = new Array<number>(compressedSize).fill(0);
  return [...header, ...nameBytes, ...extraBytes, ...compressedBytes];
}

function validMimetypeEntryBytes(content: string): Uint8Array {
  const header: number[] = new Array<number>(ZIP_LOCAL_FILE_HEADER_SIZE).fill(
    0,
  );
  header[0] = ZIP_SIGNATURE_P;
  header[1] = ZIP_SIGNATURE_K;
  header[2] = ZIP_SIGNATURE_LOCAL_FILE_MARKER;
  header[3] = ZIP_SIGNATURE_LOCAL_FILE_HEADER;
  header[ZIP_FILENAME_LENGTH_OFFSET] = MIMETYPE_ENTRY_NAME.length;
  header[ZIP_EXTRA_FIELD_LENGTH_OFFSET] = 0;
  const nameBytes = Array.from(new TextEncoder().encode(MIMETYPE_ENTRY_NAME));
  const contentBytes = Array.from(new TextEncoder().encode(content));
  return Uint8Array.from([...header, ...nameBytes, ...contentBytes]);
}

describe("readUint16LE", () => {
  it("reads two bytes little-endian", () => {
    const lowByte = 0x34;
    const highByte = 0x12;
    const expected = 0x1234;
    expect(readUint16LE(Uint8Array.from([lowByte, highByte]), 0)).toBe(
      expected,
    );
  });

  it("reads at a non-zero offset, not adjacent bytes on the wrong side of it", () => {
    const precedingByte = 0xaa;
    const lowByte = 0x12;
    const highByte = 0x34;
    const expected = 0x3412;
    expect(
      readUint16LE(Uint8Array.from([precedingByte, lowByte, highByte]), 1),
    ).toBe(expected);
  });

  it("throws when zero bytes remain at the offset", () => {
    expect(() => readUint16LE(Uint8Array.from([]), 0)).toThrow(
      "truncated zip bytes while reading a uint16 at offset 0",
    );
  });

  it("throws when only the first of the two bytes remains", () => {
    const soleByte = 0x12;
    expect(() => readUint16LE(Uint8Array.from([soleByte]), 0)).toThrow(
      "truncated zip bytes while reading a uint16 at offset 0",
    );
  });
});

describe("readUint32LE", () => {
  it("reads four bytes little-endian", () => {
    const byte0 = 0x78;
    const byte1 = 0x56;
    const byte2 = 0x34;
    const byte3 = 0x12;
    const expected = 0x12345678;
    expect(readUint32LE(Uint8Array.from([byte0, byte1, byte2, byte3]), 0)).toBe(
      expected,
    );
  });

  it("throws when zero of the four bytes remain", () => {
    expect(() => readUint32LE(Uint8Array.from([]), 0)).toThrow(
      "truncated zip bytes while reading a uint32 at offset 0",
    );
  });

  it("throws when only the first byte remains", () => {
    expect(() => readUint32LE(Uint8Array.from([1]), 0)).toThrow(
      "truncated zip bytes while reading a uint32 at offset 0",
    );
  });

  it("throws when only the first two bytes remain", () => {
    expect(() => readUint32LE(Uint8Array.from([1, 2]), 0)).toThrow(
      "truncated zip bytes while reading a uint32 at offset 0",
    );
  });

  it("throws when only the first three bytes remain", () => {
    const threeArbitraryBytes = Array.from(
      { length: 3 },
      (_, index) => index + 1,
    );
    expect(() => readUint32LE(Uint8Array.from(threeArbitraryBytes), 0)).toThrow(
      "truncated zip bytes while reading a uint32 at offset 0",
    );
  });
});

describe("localFileHeaderNames", () => {
  it("skips a local file header's own extra field to locate the next entry", () => {
    const extraLength = 4;
    const bytes = Uint8Array.from([
      ...buildLocalFileHeader("a.txt", { extraLength }),
      ...buildLocalFileHeader("b.txt"),
    ]);
    expect(localFileHeaderNames(bytes)).toEqual(["a.txt", "b.txt"]);
  });

  it("skips a local file header's own compressed data to locate the next entry", () => {
    const compressedSize = 6;
    const bytes = Uint8Array.from([
      ...buildLocalFileHeader("a.txt", { compressedSize }),
      ...buildLocalFileHeader("b.txt"),
    ]);
    expect(localFileHeaderNames(bytes)).toEqual(["a.txt", "b.txt"]);
  });

  it("stops cleanly once the byte range ends exactly at the last header's own end, with nothing left to read", () => {
    const bytes = Uint8Array.from(buildLocalFileHeader("only.txt"));
    expect(localFileHeaderNames(bytes)).toEqual(["only.txt"]);
  });
});

describe("assertMimetypeEntryLayout", () => {
  const mediaType = "application/epub+zip";

  it("passes for a well-formed stored mimetype entry", () => {
    expect(() => {
      assertMimetypeEntryLayout(validMimetypeEntryBytes(mediaType), mediaType);
    }).not.toThrow();
  });

  it("throws when the local file header signature is wrong", () => {
    const bytes = validMimetypeEntryBytes(mediaType);
    bytes[0] = 0;
    expect(() => {
      assertMimetypeEntryLayout(bytes, mediaType);
    }).toThrow();
  });

  it("throws when the entry is not stored uncompressed", () => {
    const notStoredCompressionMethod = 8;
    const bytes = validMimetypeEntryBytes(mediaType);
    bytes[ZIP_COMPRESSION_METHOD_OFFSET] = notStoredCompressionMethod;
    expect(() => {
      assertMimetypeEntryLayout(bytes, mediaType);
    }).toThrow();
  });

  it("throws when the declared filename length is not exactly 8", () => {
    const bytes = validMimetypeEntryBytes(mediaType);
    bytes[ZIP_FILENAME_LENGTH_OFFSET] = MIMETYPE_ENTRY_NAME.length + 1;
    expect(() => {
      assertMimetypeEntryLayout(bytes, mediaType);
    }).toThrow();
  });

  it("throws when the declared extra field length is not zero", () => {
    const bytes = validMimetypeEntryBytes(mediaType);
    bytes[ZIP_EXTRA_FIELD_LENGTH_OFFSET] = 1;
    expect(() => {
      assertMimetypeEntryLayout(bytes, mediaType);
    }).toThrow();
  });

  it("throws when the filename bytes do not spell mimetype", () => {
    const bytes = validMimetypeEntryBytes(mediaType);
    bytes[ZIP_LOCAL_FILE_HEADER_SIZE] = "x".charCodeAt(0);
    expect(() => {
      assertMimetypeEntryLayout(bytes, mediaType);
    }).toThrow();
  });

  it("throws when the entry content does not match the expected media type", () => {
    const bytes = validMimetypeEntryBytes(mediaType);
    expect(() => {
      assertMimetypeEntryLayout(bytes, "something/else");
    }).toThrow();
  });
});
