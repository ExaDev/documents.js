import { describe, expect, it } from "vitest";
import {
  assertMimetypeEntryLayout,
  localFileHeaderNames,
  readUint16LE,
  readUint32LE,
} from "./zip";

// A local file header's own fixed-position fields this module's readers walk: signature (4 bytes), then a run of fields irrelevant to these helpers up to compressed size at +18 (4 bytes), filename length at +26 (2 bytes), extra field length at +28 (2 bytes), the filename itself starting at +30, then the extra field, then the compressed data.
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
  const header: number[] = new Array<number>(30).fill(0);
  header[0] = 0x50;
  header[1] = 0x4b;
  header[2] = 0x03;
  header[3] = 0x04;
  header[18] = compressedSize & 0xff;
  header[19] = (compressedSize >> 8) & 0xff;
  header[20] = (compressedSize >> 16) & 0xff;
  header[21] = (compressedSize >> 24) & 0xff;
  header[26] = nameBytes.length & 0xff;
  header[27] = (nameBytes.length >> 8) & 0xff;
  header[28] = extraLength & 0xff;
  header[29] = (extraLength >> 8) & 0xff;
  const extraBytes: number[] = new Array<number>(extraLength).fill(0);
  const compressedBytes: number[] = new Array<number>(compressedSize).fill(0);
  return [...header, ...nameBytes, ...extraBytes, ...compressedBytes];
}

function validMimetypeEntryBytes(content: string): Uint8Array {
  const header: number[] = new Array<number>(30).fill(0);
  header[0] = 0x50;
  header[1] = 0x4b;
  header[2] = 0x03;
  header[3] = 0x04;
  header[26] = 8;
  header[28] = 0;
  const nameBytes = Array.from(new TextEncoder().encode("mimetype"));
  const contentBytes = Array.from(new TextEncoder().encode(content));
  return Uint8Array.from([...header, ...nameBytes, ...contentBytes]);
}

describe("readUint16LE", () => {
  it("reads two bytes little-endian", () => {
    expect(readUint16LE(Uint8Array.from([0x34, 0x12]), 0)).toBe(0x1234);
  });

  it("reads at a non-zero offset, not adjacent bytes on the wrong side of it", () => {
    expect(readUint16LE(Uint8Array.from([0xaa, 0x12, 0x34]), 1)).toBe(0x3412);
  });

  it("throws when zero bytes remain at the offset", () => {
    expect(() => readUint16LE(Uint8Array.from([]), 0)).toThrow(
      "truncated zip bytes while reading a uint16 at offset 0",
    );
  });

  it("throws when only the first of the two bytes remains", () => {
    expect(() => readUint16LE(Uint8Array.from([0x12]), 0)).toThrow(
      "truncated zip bytes while reading a uint16 at offset 0",
    );
  });
});

describe("readUint32LE", () => {
  it("reads four bytes little-endian", () => {
    expect(readUint32LE(Uint8Array.from([0x78, 0x56, 0x34, 0x12]), 0)).toBe(
      0x12345678,
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
    expect(() => readUint32LE(Uint8Array.from([1, 2, 3]), 0)).toThrow(
      "truncated zip bytes while reading a uint32 at offset 0",
    );
  });
});

describe("localFileHeaderNames", () => {
  it("skips a local file header's own extra field to locate the next entry", () => {
    const bytes = Uint8Array.from([
      ...buildLocalFileHeader("a.txt", { extraLength: 4 }),
      ...buildLocalFileHeader("b.txt"),
    ]);
    expect(localFileHeaderNames(bytes)).toEqual(["a.txt", "b.txt"]);
  });

  it("skips a local file header's own compressed data to locate the next entry", () => {
    const bytes = Uint8Array.from([
      ...buildLocalFileHeader("a.txt", { compressedSize: 6 }),
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
    const bytes = validMimetypeEntryBytes(mediaType);
    bytes[8] = 8;
    expect(() => {
      assertMimetypeEntryLayout(bytes, mediaType);
    }).toThrow();
  });

  it("throws when the declared filename length is not exactly 8", () => {
    const bytes = validMimetypeEntryBytes(mediaType);
    bytes[26] = 9;
    expect(() => {
      assertMimetypeEntryLayout(bytes, mediaType);
    }).toThrow();
  });

  it("throws when the declared extra field length is not zero", () => {
    const bytes = validMimetypeEntryBytes(mediaType);
    bytes[28] = 1;
    expect(() => {
      assertMimetypeEntryLayout(bytes, mediaType);
    }).toThrow();
  });

  it("throws when the filename bytes do not spell mimetype", () => {
    const bytes = validMimetypeEntryBytes(mediaType);
    bytes[30] = "x".charCodeAt(0);
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
