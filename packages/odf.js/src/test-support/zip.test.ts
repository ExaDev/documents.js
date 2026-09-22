import { describe, expect, it } from "vitest";
import {
  assertMimetypeEntryLayout,
  localFileHeaderNames,
  readUint16LE,
  readUint32LE,
} from "./zip";

// Builds a single synthetic local file header (signature 0x04034b50) plus a body of `compressedSize` zero bytes, with an arbitrary filename and extra-field length, entirely by hand rather than through fflate — fflate's own zipSync never emits a non-empty extra field, so exercising the `extraLength` term in localFileHeaderNames's offset arithmetic needs bytes built directly.
function buildLocalFileHeader(options: {
  filename: string;
  extraLength: number;
  compressedSize: number;
}): Uint8Array {
  const nameBytes = new TextEncoder().encode(options.filename);
  const total =
    30 + nameBytes.length + options.extraLength + options.compressedSize;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(8, 0, true); // compression method
  view.setUint32(18, options.compressedSize, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, options.extraLength, true);
  bytes.set(nameBytes, 30);
  return bytes;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
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
  it("combines two distinct bytes little-endian", () => {
    // 0x02 | (0x01 << 8) = 0x0102 — transposing the bytes or negating the shift would give a different value.
    expect(readUint16LE(new Uint8Array([0x02, 0x01]), 0)).toBe(0x0102);
  });

  it("reads from a non-zero offset (offset + 1, not offset - 1, addresses the high byte)", () => {
    const bytes = new Uint8Array([0xff, 0x02, 0x01, 0xff]);
    expect(readUint16LE(bytes, 1)).toBe(0x0102);
  });

  it("throws when both bytes are missing", () => {
    expect(() => readUint16LE(new Uint8Array([]), 0)).toThrow(
      "truncated zip bytes while reading a uint16 at offset 0",
    );
  });

  it("throws when only the high byte is missing", () => {
    expect(() => readUint16LE(new Uint8Array([0x42]), 0)).toThrow(
      "truncated zip bytes while reading a uint16 at offset 0",
    );
  });

  it("throws when only the low byte is missing (negative offset)", () => {
    // offset=-1 makes bytes[-1] (the low byte) undefined while bytes[0] (the high byte) is defined.
    expect(() => readUint16LE(new Uint8Array([0x42, 0x43]), -1)).toThrow(
      "truncated zip bytes while reading a uint16 at offset -1",
    );
  });

  it("reports the exact offset that failed, not a neighbouring one", () => {
    expect(() => readUint16LE(new Uint8Array([1, 2, 3]), 5)).toThrow(
      "truncated zip bytes while reading a uint16 at offset 5",
    );
  });
});

describe("readUint32LE", () => {
  it("combines four distinct bytes little-endian, unsigned", () => {
    // 0x04 | (0x03 << 8) | (0x02 << 16) | (0x01 << 24) = 0x01020304
    expect(readUint32LE(new Uint8Array([0x04, 0x03, 0x02, 0x01]), 0)).toBe(
      0x01020304,
    );
  });

  it("stays unsigned even when the top byte would set the sign bit", () => {
    // Without the >>> 0 conversion this would read as a negative number.
    expect(readUint32LE(new Uint8Array([0x00, 0x00, 0x00, 0xff]), 0)).toBe(
      0xff000000,
    );
  });

  it("throws when all four bytes are missing", () => {
    expect(() => readUint32LE(new Uint8Array([]), 0)).toThrow(
      "truncated zip bytes while reading a uint32 at offset 0",
    );
  });

  it("throws when only the last byte is missing", () => {
    expect(() => readUint32LE(new Uint8Array([1, 2, 3]), 0)).toThrow(
      "truncated zip bytes while reading a uint32 at offset 0",
    );
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
    expect(() => readUint32LE(new Uint8Array([1, 2, 3]), -1)).toThrow(
      "truncated zip bytes while reading a uint32 at offset -1",
    );
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
    const trailer = new Uint8Array([0x50, 0x4b, 0x01, 0x02]); // central directory signature, not a local file header
    const bytes = concatBytes([header, trailer]);
    expect(localFileHeaderNames(bytes)).toEqual(["only.xml"]);
  });
});

describe("assertMimetypeEntryLayout", () => {
  const mediaType = "application/vnd.oasis.opendocument.text";

  function validLayout(): Uint8Array {
    return buildLocalFileHeader({
      filename: "mimetype",
      extraLength: 0,
      compressedSize: 0,
    }).slice(0, 30 + 8); // header only, then the content bytes appended below
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
    bytes[8] = 8; // DEFLATE, not stored
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
