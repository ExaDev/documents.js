import { describe, expect, it } from "vitest";
import {
  bigEndianUint16At,
  bigEndianUint32At,
  scanImagePayload,
} from "./image";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function u32be(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function u16be(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function pngChunk(type: string, data: readonly number[]): number[] {
  return [
    ...u32be(data.length),
    ...Array.from(type, (c) => c.charCodeAt(0)),
    ...data,
    0,
    0,
    0,
    0, // crc, not verified by the scanner
  ];
}

// A minimal well-formed PNG: signature, IHDR, IDAT, IEND.
function tinyPng(): number[] {
  return [
    ...PNG_SIGNATURE,
    ...pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
    ...pngChunk("IDAT", [0x78, 0x01]),
    ...pngChunk("IEND", []),
  ];
}

// A JPEG marker segment: FF <marker> [length incl. itself] <data>. SOI, standalone markers, and SOS are built separately since they don't share this shape.
function jpegSegment(marker: number, data: readonly number[]): number[] {
  return [0xff, marker, ...u16be(data.length + 2), ...data];
}

// A minimal well-formed JPEG: SOI, one APP0 segment, SOS with a length header, entropy-coded scan data (including a stuffed FF00, which must not be mistaken for EOI), then EOI.
function tinyJpeg(
  options: { readonly scanData?: readonly number[] } = {},
): number[] {
  const scanData = options.scanData ?? [0x12, 0xff, 0x00, 0x34];
  return [
    0xff,
    0xd8, // SOI
    ...jpegSegment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00]), // APP0
    ...jpegSegment(0xda, [0x01, 0x02, 0x03]), // SOS header
    ...scanData,
    0xff,
    0xd9, // EOI
  ];
}

describe("bigEndianUint32At", () => {
  // A distinct, nonzero digit in every byte position, so a wrong sign between any two terms or a wrong operator on any one of them changes the result -- every real PNG/JPEG fixture below keeps its own chunk/segment lengths small, leaving every byte but the last at zero, where a wrong sign or operator on that term would go unobserved.
  it("assembles four bytes into one big-endian 32-bit value", () => {
    expect(bigEndianUint32At(new Uint8Array([0x12, 0x34, 0x56, 0x78]), 0)).toBe(
      0x12345678,
    );
  });
});

describe("bigEndianUint16At", () => {
  it("assembles two bytes into one big-endian 16-bit value", () => {
    expect(bigEndianUint16At(new Uint8Array([0x12, 0x34]), 0)).toBe(0x1234);
  });
});

describe("scanImagePayload", () => {
  it("returns undefined for a packet with neither signature at all", () => {
    expect(scanImagePayload(new Uint8Array([1, 2, 3, 4, 5]))).toBeUndefined();
  });

  // PNG_SIGNATURE's own first byte, with no room left for the other seven: a fit check that let this position through anyway would matter here, since bytesMatchAt now throws for an out-of-range byte rather than silently answering false, and the mismatched bytes elsewhere in this file's other fixtures never happen to start with 0x89 this close to the buffer's own end.
  it("does not attempt a PNG signature match too close to the buffer's own end to ever complete", () => {
    expect(scanImagePayload(new Uint8Array([1, 2, 3, 0x89]))).toBeUndefined();
  });

  // JPEG_SOI's own first byte (0xFF), with no room for the second: the same fit-check concern as the PNG case above, isolated to the shorter signature.
  it("does not attempt a JPEG signature match too close to the buffer's own end to ever complete", () => {
    expect(scanImagePayload(new Uint8Array([1, 2, 3, 0xff]))).toBeUndefined();
  });

  describe("PNG", () => {
    it("rejects an IEND chunk whose own declared length runs past the buffer, rather than accepting a truncated span", () => {
      // The IEND check itself sits right after the overrun guard: skipping that guard would let a lying IEND chunk (declaring far more data than the buffer actually holds) slip through and return a truncated-but-defined span instead of refusing.
      const bytes = new Uint8Array([
        ...PNG_SIGNATURE,
        ...u32be(1000), // claims 1000 bytes of chunk data
        ...Array.from("IEND", (c) => c.charCodeAt(0)),
        // no data, no crc -- the buffer ends immediately after the type
      ]);
      expect(scanImagePayload(bytes)).toBeUndefined();
    });

    it("lifts a well-formed PNG payload, bounded exactly by its own chunk chain", () => {
      const png = tinyPng();
      const bytes = new Uint8Array([9, 9, 9, ...png, 7, 7, 7]); // real prefix/suffix garbage
      const result = scanImagePayload(bytes);
      expect(result?.format).toBe("png");
      expect(Array.from(result?.bytes ?? [])).toEqual(png);
    });

    it("rejects a PNG whose chunk chain never reaches IEND before the buffer ends", () => {
      const bytes = new Uint8Array([
        ...PNG_SIGNATURE,
        ...pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
        // no IEND -- the buffer simply ends
      ]);
      expect(scanImagePayload(bytes)).toBeUndefined();
    });

    it("rejects a PNG chunk whose own length runs past the buffer", () => {
      const bytes = new Uint8Array([
        ...PNG_SIGNATURE,
        ...u32be(1000), // claims 1000 bytes of chunk data
        ...Array.from("IHDR", (c) => c.charCodeAt(0)),
        0,
        0, // far fewer real bytes than claimed
      ]);
      expect(scanImagePayload(bytes)).toBeUndefined();
    });

    it("rejects a PNG cut off before its first chunk header is even complete", () => {
      const bytes = new Uint8Array([...PNG_SIGNATURE, 0, 0, 0]); // 3 bytes of an 8-byte chunk header
      expect(scanImagePayload(bytes)).toBeUndefined();
    });

    // A chunk whose length + header + crc lands exactly on the buffer's own end -- the one boundary where "runs past" and "fits exactly" disagree.
    it("accepts a final chunk whose own extent exactly fills the rest of the buffer", () => {
      const bytes = new Uint8Array([
        ...PNG_SIGNATURE,
        ...pngChunk("IEND", []), // IEND with no data, ending exactly at the buffer's own end
      ]);
      const result = scanImagePayload(bytes);
      expect(result?.format).toBe("png");
      expect(result?.bytes.length).toBe(bytes.length);
    });
  });

  describe("JPEG", () => {
    it("lifts a well-formed JPEG payload ending at a plain EOI, bounded exactly", () => {
      const jpeg = tinyJpeg();
      const bytes = new Uint8Array([9, 9, 9, ...jpeg, 7, 7, 7]);
      const result = scanImagePayload(bytes);
      expect(result?.format).toBe("jpeg");
      expect(Array.from(result?.bytes ?? [])).toEqual(jpeg);
    });

    it("skips a run of fill bytes (0xFF) before a real marker", () => {
      const jpeg = [
        0xff,
        0xd8, // SOI
        0xff,
        0xff,
        0xff, // fill bytes
        ...jpegSegment(0xe0, [0x00]),
        0xff,
        0xd9, // EOI
      ];
      const result = scanImagePayload(new Uint8Array(jpeg));
      expect(result?.format).toBe("jpeg");
    });

    it("treats a restart marker (0xD0-0xD7) as standalone, carrying no length of its own", () => {
      const jpeg = [
        0xff,
        0xd8, // SOI
        0xff,
        0xd0, // RST0, standalone
        ...jpegSegment(0xe0, [0x00]),
        0xff,
        0xd9,
      ];
      const result = scanImagePayload(new Uint8Array(jpeg));
      expect(result?.format).toBe("jpeg");
    });

    it("treats TEM (0x01) as standalone, carrying no length of its own", () => {
      const jpeg = [
        0xff,
        0xd8,
        0xff,
        0x01, // TEM, standalone
        ...jpegSegment(0xe0, [0x00]),
        0xff,
        0xd9,
      ];
      const result = scanImagePayload(new Uint8Array(jpeg));
      expect(result?.format).toBe("jpeg");
    });

    it("does not treat a marker just outside the restart range as standalone", () => {
      // 0xD8 (SOI) reappearing mid-stream is not itself one of the RST0-RST7 (0xD0-0xD7) codes but IS separately named standalone -- 0xCF, one below 0xD0, is neither, and must be read as an ordinary length-carrying segment.
      const jpeg = [
        0xff,
        0xd8,
        ...jpegSegment(0xcf, [0x00]), // an ordinary (fictitious) marker just below the restart range
        0xff,
        0xd9,
      ];
      const result = scanImagePayload(new Uint8Array(jpeg));
      expect(result?.format).toBe("jpeg");
    });

    it("rejects a JPEG with a stray non-0xFF byte where a marker prefix was expected", () => {
      const jpeg = [0xff, 0xd8, 0x12, 0x34];
      expect(scanImagePayload(new Uint8Array(jpeg))).toBeUndefined();
    });

    it("rejects a bare EOI byte value that never had its own 0xFF marker prefix", () => {
      // Skipping the marker-prefix guard would let this 0xD9 byte itself be read as the next marker, wrongly matching the EOI case and returning a defined (truncated) payload instead of refusing.
      const jpeg = [0xff, 0xd8, 0xd9];
      expect(scanImagePayload(new Uint8Array(jpeg))).toBeUndefined();
    });

    it("treats 0xD7, the top of the restart range, as standalone", () => {
      const jpeg = [
        0xff,
        0xd8,
        0xff,
        0xd7, // RST7, the restart range's own upper bound
        ...jpegSegment(0xe0, [0x00]),
        0xff,
        0xd9,
      ];
      const result = scanImagePayload(new Uint8Array(jpeg));
      expect(result?.format).toBe("jpeg");
    });

    it("treats SOI (0xD8) reappearing mid-stream as standalone, not a length-carrying marker", () => {
      const jpeg = [
        0xff,
        0xd8,
        0xff,
        0xd8, // SOI again, mid-stream
        ...jpegSegment(0xe0, [0x00]),
        0xff,
        0xd9,
      ];
      const result = scanImagePayload(new Uint8Array(jpeg));
      expect(result?.format).toBe("jpeg");
    });

    it("rejects a JPEG that ends right after SOI, with no marker at all", () => {
      expect(scanImagePayload(new Uint8Array([0xff, 0xd8]))).toBeUndefined();
    });

    it("rejects a JPEG that ends in a run of fill bytes with no real marker after them", () => {
      const jpeg = [0xff, 0xd8, 0xff, 0xff, 0xff];
      expect(scanImagePayload(new Uint8Array(jpeg))).toBeUndefined();
    });

    it("rejects a length-carrying marker with no room for its own two-byte length", () => {
      const jpeg = [0xff, 0xd8, 0xff, 0xe0]; // APP0, no length bytes at all
      expect(scanImagePayload(new Uint8Array(jpeg))).toBeUndefined();
    });

    it("rejects a marker whose own stated length is less than the two length bytes themselves", () => {
      const jpeg = [0xff, 0xd8, 0xff, 0xe0, ...u16be(1)]; // length 1, smaller than the length field's own two bytes
      expect(scanImagePayload(new Uint8Array(jpeg))).toBeUndefined();
    });

    it("rejects a marker whose own stated length runs past the buffer", () => {
      const jpeg = [0xff, 0xd8, 0xff, 0xe0, ...u16be(100)]; // claims 100 bytes total, far more than remain
      expect(scanImagePayload(new Uint8Array(jpeg))).toBeUndefined();
    });

    it("rejects a length-too-small marker even with plenty of trailing bytes, isolating that check from the overrun check", () => {
      // length 1 alone must refuse this, with none of the overrun arithmetic coming into play (there is ample room left).
      const jpeg = [
        0xff,
        0xd8,
        0xff,
        0xe0,
        ...u16be(1),
        0,
        0,
        0,
        0,
        0xff,
        0xd9,
      ];
      expect(scanImagePayload(new Uint8Array(jpeg))).toBeUndefined();
    });

    it("rejects a length that is at least 2 but still overruns the buffer, isolating that check from the too-small check", () => {
      const jpeg = [0xff, 0xd8, 0xff, 0xe0, ...u16be(3)]; // length 3 (not < 2), but nothing follows the length field at all
      expect(scanImagePayload(new Uint8Array(jpeg))).toBeUndefined();
    });

    it("accepts a segment whose own length is exactly 2 (no data at all), proving the boundary is < 2 and not <= 2", () => {
      const jpeg = [0xff, 0xd8, 0xff, 0xe0, ...u16be(2), 0xff, 0xd9];
      const result = scanImagePayload(new Uint8Array(jpeg));
      expect(result?.format).toBe("jpeg");
    });

    it("refuses a malformed SOS length rather than searching arbitrarily far ahead for an EOI that happens to exist", () => {
      // A length of 1 is invalid (smaller than the length field's own two bytes); skipping that guard for SOS specifically would let the entropy-search fall through to indexOf and find this later, genuine FF D9 -- masking the real malformed-length defect with a false decode.
      const jpeg = [
        0xff,
        0xd8,
        0xff,
        0xda,
        ...u16be(1),
        0x12,
        0x34,
        0xff,
        0xd9,
      ];
      expect(scanImagePayload(new Uint8Array(jpeg))).toBeUndefined();
    });

    it("refuses garbage following an ordinary segment rather than searching ahead for an EOI as if it were SOS", () => {
      // If the ordinary APP0 marker were ever treated as SOS, the entropy search would ignore that the very next byte is not a valid marker prefix at all, and would instead find this later, genuine FF D9.
      const jpeg = [
        0xff,
        0xd8,
        ...jpegSegment(0xe0, [0x00]),
        0x11,
        0x22, // garbage: not a marker prefix
        0xff,
        0xd9,
      ];
      expect(scanImagePayload(new Uint8Array(jpeg))).toBeUndefined();
    });

    // A segment whose own length exactly consumes the rest of the buffer -- the boundary where "runs past" and "fits exactly" disagree.
    it("accepts a length-carrying segment whose own extent exactly fills the rest of the buffer, then correctly finds no EOI", () => {
      const jpeg = [0xff, 0xd8, ...jpegSegment(0xe0, [0x00])]; // nothing after the segment at all
      expect(scanImagePayload(new Uint8Array(jpeg))).toBeUndefined();
    });

    it("continues past an ordinary segment to read the marker that follows it, not a byte off", () => {
      const jpeg = [
        0xff,
        0xd8,
        ...jpegSegment(0xe0, [0x01, 0x02, 0x03]), // 3 bytes of real data, cursor must land exactly after it
        0xff,
        0xd9,
      ];
      const result = scanImagePayload(new Uint8Array(jpeg));
      expect(result?.format).toBe("jpeg");
      expect(result?.bytes.length).toBe(jpeg.length);
    });

    it("rejects a scan (SOS) whose entropy-coded data never reaches an EOI", () => {
      const jpeg = [
        0xff,
        0xd8,
        ...jpegSegment(0xda, [0x01]),
        0x12,
        0x34,
        0x56, // entropy data, no FF D9 anywhere
      ];
      expect(scanImagePayload(new Uint8Array(jpeg))).toBeUndefined();
    });

    it("does not mistake a stuffed FF00 inside entropy-coded data for EOI", () => {
      const jpeg = tinyJpeg({ scanData: [0xff, 0x00, 0xff, 0x00] });
      const result = scanImagePayload(new Uint8Array(jpeg));
      expect(result?.format).toBe("jpeg");
      expect(result?.bytes.length).toBe(jpeg.length);
    });

    // The EOI marker landing exactly on the buffer's own final two bytes -- the one boundary where indexOf's own "does the needle still fit" check matters, since a strictly-off-by-one version would fail to find an EOI that is genuinely, completely present.
    it("finds an EOI that is exactly the buffer's own last two bytes", () => {
      const jpeg = tinyJpeg();
      expect(jpeg[jpeg.length - 2]).toBe(0xff);
      expect(jpeg[jpeg.length - 1]).toBe(0xd9);
      const result = scanImagePayload(new Uint8Array(jpeg));
      expect(result?.format).toBe("jpeg");
      expect(result?.bytes.length).toBe(jpeg.length);
    });
  });

  describe("choosing between PNG and JPEG when both are present", () => {
    it("prefers whichever signature appears first when both are present, PNG first", () => {
      const png = tinyPng();
      const jpeg = tinyJpeg();
      const bytes = new Uint8Array([...png, ...jpeg]);
      expect(scanImagePayload(bytes)?.format).toBe("png");
    });

    it("prefers whichever signature appears first when both are present, JPEG first", () => {
      const png = tinyPng();
      const jpeg = tinyJpeg();
      const bytes = new Uint8Array([...jpeg, ...png]);
      expect(scanImagePayload(bytes)?.format).toBe("jpeg");
    });

    it("falls back to JPEG when only JPEG's signature is present", () => {
      const jpeg = tinyJpeg();
      expect(scanImagePayload(new Uint8Array(jpeg))?.format).toBe("jpeg");
    });
  });
});
