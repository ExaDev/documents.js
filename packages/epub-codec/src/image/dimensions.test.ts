import { describe, expect, it } from "vitest";
import {
  detectImageFormat,
  POINTS_PER_PIXEL,
  readImageDimensions,
} from "./dimensions";

// A minimal PNG carrying only what this module reads: the 8-byte signature plus an IHDR chunk (length, type, width, height, and the five remaining bytes IHDR requires -- bit depth, colour type, compression, filter, interlace -- whose values don't matter to a dimensions-only reader). No IDAT/IEND: this module never walks past IHDR.
function fakePng(widthPx: number, heightPx: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13); // IHDR chunk data length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // 'IHDR'
  view.setUint32(16, widthPx);
  view.setUint32(20, heightPx);
  bytes.set([8, 6, 0, 0, 0], 24); // bit depth, colour type, compression, filter, interlace
  return bytes;
}

// A minimal baseline JPEG: SOI, then an SOF0 segment carrying height/width/components, nothing past it.
function fakeJpeg(widthPx: number, heightPx: number): Uint8Array {
  const bytes = new Uint8Array(2 + 2 + 2 + 1 + 2 + 2 + 1);
  let offset = 0;
  bytes.set([0xff, 0xd8], offset); // SOI
  offset += 2;
  bytes.set([0xff, 0xc0], offset); // SOF0
  offset += 2;
  const view = new DataView(bytes.buffer);
  view.setUint16(offset, 8); // segment length (includes these 2 bytes)
  offset += 2;
  bytes[offset] = 8; // precision
  offset += 1;
  view.setUint16(offset, heightPx);
  offset += 2;
  view.setUint16(offset, widthPx);
  offset += 2;
  bytes[offset] = 1; // components
  return bytes;
}

describe("detectImageFormat", () => {
  it("recognises a PNG signature", () => {
    expect(detectImageFormat(fakePng(1, 1))).toBe("png");
  });

  it("recognises a JPEG SOI marker", () => {
    expect(detectImageFormat(fakeJpeg(1, 1))).toBe("jpeg");
  });

  it("returns undefined for neither", () => {
    expect(
      detectImageFormat(new Uint8Array([0x47, 0x49, 0x46])),
    ).toBeUndefined();
  });
});

describe("readImageDimensions", () => {
  it("reads PNG width/height from IHDR", () => {
    expect(readImageDimensions(fakePng(640, 480))).toEqual({
      widthPx: 640,
      heightPx: 480,
    });
  });

  it("reads JPEG width/height from SOF0", () => {
    expect(readImageDimensions(fakeJpeg(800, 600))).toEqual({
      widthPx: 800,
      heightPx: 600,
    });
  });

  it("returns undefined for a truncated PNG", () => {
    expect(readImageDimensions(fakePng(1, 1).subarray(0, 10))).toBeUndefined();
  });

  it("returns undefined for neither format", () => {
    expect(
      readImageDimensions(new Uint8Array([0x00, 0x01, 0x02])),
    ).toBeUndefined();
  });
});

describe("POINTS_PER_PIXEL", () => {
  it("is the CSS reference-pixel ratio (72/96)", () => {
    expect(POINTS_PER_PIXEL).toBeCloseTo(0.75);
  });
});

// A generic JPEG marker segment: FF, the marker byte, then a big-endian length (including these two length bytes themselves) followed by (length - 2) payload bytes. Used to build multi-segment streams the fixed-shape fakeJpeg() above can't express.
function jpegSegment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

function concatBytes(...chunks: number[][]): Uint8Array {
  return new Uint8Array(chunks.flat());
}

const SOI = [0xff, 0xd8];
// An SOF0 segment carrying only height/width/components -- the same shape fakeJpeg() builds inline, expressed as a reusable segment for streams that need other markers around it.
function sof0Segment(widthPx: number, heightPx: number): number[] {
  return jpegSegment(0xc0, [
    8, // precision
    (heightPx >> 8) & 0xff,
    heightPx & 0xff,
    (widthPx >> 8) & 0xff,
    widthPx & 0xff,
    1, // components
  ]);
}

describe("detectImageFormat boundary cases", () => {
  it("recognises a bare 8-byte PNG signature with no IHDR at all", () => {
    expect(detectImageFormat(new Uint8Array(PNG_SIG))).toBe("png");
  });

  it("does not treat a partially-matching 8-byte array as PNG", () => {
    // Only byte 0 matches the real signature -- .some() would wrongly accept this, .every() correctly rejects it.
    const bytes = new Uint8Array([0x89, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectImageFormat(bytes)).toBeUndefined();
  });

  it("recognises a bare 2-byte JPEG SOI with nothing else", () => {
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8]))).toBe("jpeg");
  });

  it("does not treat a single 0xff byte as JPEG", () => {
    expect(detectImageFormat(new Uint8Array([0xff]))).toBeUndefined();
  });

  it("does not treat 0xff followed by the wrong second byte as JPEG", () => {
    expect(detectImageFormat(new Uint8Array([0xff, 0x00]))).toBeUndefined();
  });

  it("does not treat the wrong first byte followed by 0xd8 as JPEG", () => {
    expect(detectImageFormat(new Uint8Array([0x00, 0xd8]))).toBeUndefined();
  });
});

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("readImageDimensions PNG IHDR boundary cases", () => {
  it("reads dimensions from an IHDR ending exactly at the 24-byte minimum", () => {
    expect(readImageDimensions(fakePng(1, 1).subarray(0, 24))).toEqual({
      widthPx: 1,
      heightPx: 1,
    });
  });

  it("returns undefined one byte short of the 24-byte IHDR minimum", () => {
    expect(readImageDimensions(fakePng(1, 1).subarray(0, 23))).toBeUndefined();
  });

  it("rejects an IHDR chunk whose type byte 0 is wrong", () => {
    const bytes = fakePng(10, 20);
    bytes[12] = 0x00;
    expect(readImageDimensions(bytes)).toBeUndefined();
  });

  it("rejects an IHDR chunk whose type byte 1 is wrong", () => {
    const bytes = fakePng(10, 20);
    bytes[13] = 0x00;
    expect(readImageDimensions(bytes)).toBeUndefined();
  });

  it("rejects an IHDR chunk whose type byte 2 is wrong", () => {
    const bytes = fakePng(10, 20);
    bytes[14] = 0x00;
    expect(readImageDimensions(bytes)).toBeUndefined();
  });

  it("rejects an IHDR chunk whose type byte 3 is wrong", () => {
    const bytes = fakePng(10, 20);
    bytes[15] = 0x00;
    expect(readImageDimensions(bytes)).toBeUndefined();
  });
});

describe("readImageDimensions JPEG marker-walking", () => {
  it("skips a leading run of 0xff fill bytes before the real marker", () => {
    const bytes = concatBytes(SOI, [0xff, 0xff, 0xff], sof0Segment(50, 60));
    expect(readImageDimensions(bytes)).toEqual({ widthPx: 50, heightPx: 60 });
  });

  it("skips a non-0xff stray byte between segments", () => {
    const bytes = concatBytes(SOI, [0x00], sof0Segment(50, 60));
    expect(readImageDimensions(bytes)).toEqual({ widthPx: 50, heightPx: 60 });
  });

  it("skips two consecutive non-0xff stray bytes, realigning on the real marker rather than misreading the second stray byte as one", () => {
    // A single stray byte happens to still land correctly because the fill-byte loop right after it absorbs the segment's own genuine 0xff. Two non-0xff bytes in a row rules that coincidence out: only advancing offset one byte at a time (rather than jumping straight into marker extraction) reaches the real segment aligned.
    const bytes = concatBytes(SOI, [0x00, 0x11], sof0Segment(50, 60));
    expect(readImageDimensions(bytes)).toEqual({ widthPx: 50, heightPx: 60 });
  });

  it("skips an APP0 segment by its declared length to reach SOF0", () => {
    const bytes = concatBytes(
      SOI,
      jpegSegment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00]),
      sof0Segment(70, 80),
    );
    expect(readImageDimensions(bytes)).toEqual({ widthPx: 70, heightPx: 80 });
  });

  it("skips a restart marker (RST0, no length field) to reach SOF0", () => {
    const bytes = concatBytes(SOI, [0xff, 0xd0], sof0Segment(11, 22));
    expect(readImageDimensions(bytes)).toEqual({ widthPx: 11, heightPx: 22 });
  });

  it("skips a restart marker (RST7, no length field) to reach SOF0", () => {
    const bytes = concatBytes(SOI, [0xff, 0xd7], sof0Segment(11, 22));
    expect(readImageDimensions(bytes)).toEqual({ widthPx: 11, heightPx: 22 });
  });

  it("skips a TEM marker (0x01, no length field) to reach SOF0", () => {
    const bytes = concatBytes(SOI, [0xff, 0x01], sof0Segment(11, 22));
    expect(readImageDimensions(bytes)).toEqual({ widthPx: 11, heightPx: 22 });
  });

  it("skips an EOI marker (0xd9, no length field) to reach a later SOF0", () => {
    const bytes = concatBytes(SOI, [0xff, 0xd9], sof0Segment(11, 22));
    expect(readImageDimensions(bytes)).toEqual({ widthPx: 11, heightPx: 22 });
  });

  it("recognises SOF0 at the low end of the frame-marker range (0xc0)", () => {
    const bytes = concatBytes(SOI, sof0Segment(1, 2));
    expect(readImageDimensions(bytes)).toEqual({ widthPx: 1, heightPx: 2 });
  });

  it("recognises a frame marker at the high end of the range (0xcf)", () => {
    const bytes = concatBytes(SOI, jpegSegment(0xcf, [8, 0, 2, 0, 1, 1]));
    expect(readImageDimensions(bytes)).toEqual({ widthPx: 1, heightPx: 2 });
  });

  it("does not treat DHT (0xc4) as a frame header, and reads the later real SOF0", () => {
    const bytes = concatBytes(
      SOI,
      jpegSegment(0xc4, [8, 0xff, 0xff, 0xff, 0xff, 0xff]),
      sof0Segment(11, 22),
    );
    expect(readImageDimensions(bytes)).toEqual({ widthPx: 11, heightPx: 22 });
  });

  it("does not treat JPG (0xc8) as a frame header, and reads the later real SOF0", () => {
    const bytes = concatBytes(
      SOI,
      jpegSegment(0xc8, [8, 0xff, 0xff, 0xff, 0xff, 0xff]),
      sof0Segment(11, 22),
    );
    expect(readImageDimensions(bytes)).toEqual({ widthPx: 11, heightPx: 22 });
  });

  it("does not treat DAC (0xcc) as a frame header, and reads the later real SOF0", () => {
    const bytes = concatBytes(
      SOI,
      jpegSegment(0xcc, [8, 0xff, 0xff, 0xff, 0xff, 0xff]),
      sof0Segment(11, 22),
    );
    expect(readImageDimensions(bytes)).toEqual({ widthPx: 11, heightPx: 22 });
  });

  it("does not treat a marker just below the frame-marker range (0xbf) as a frame header", () => {
    const bytes = concatBytes(
      SOI,
      jpegSegment(0xbf, [0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
      sof0Segment(11, 22),
    );
    expect(readImageDimensions(bytes)).toEqual({ widthPx: 11, heightPx: 22 });
  });

  it("skips a spurious SOI byte (0xd8) reused mid-stream as its own length-less marker", () => {
    const bytes = concatBytes(SOI, [0xff, 0xd8], sof0Segment(11, 22));
    expect(readImageDimensions(bytes)).toEqual({ widthPx: 11, heightPx: 22 });
  });

  it("stops at SOS (0xda) and never reads a frame header appearing after it", () => {
    const bytes = concatBytes(SOI, jpegSegment(0xda, []), sof0Segment(11, 22));
    expect(readImageDimensions(bytes)).toBeUndefined();
  });

  it("returns undefined when the stream ends with no marker byte after a trailing 0xff", () => {
    const bytes = concatBytes(SOI, [0xff]);
    expect(readImageDimensions(bytes)).toBeUndefined();
  });

  it("returns undefined when a marker's length field is exactly cut off", () => {
    // offset + 2 === bytes.length: the two length bytes themselves are missing.
    const bytes = concatBytes(SOI, [0xff, 0xe0]);
    expect(readImageDimensions(bytes)).toBeUndefined();
  });

  it("reads a length field that ends exactly at the buffer boundary", () => {
    // offset + 2 === bytes.length for the length field itself, immediately followed by SOF0.
    const bytes = concatBytes(SOI, [0xff, 0xe0, 0x00, 0x02], sof0Segment(3, 4));
    expect(readImageDimensions(bytes)).toEqual({ widthPx: 3, heightPx: 4 });
  });

  it("returns undefined when an SOF0 segment is missing part of its width field", () => {
    // offset + 7 > bytes.length: two bytes short cuts into the width field the dims reader actually reads (the trailing, unread "components" byte alone isn't enough to trip this guard).
    const bytes = concatBytes(SOI, sof0Segment(9, 9));
    expect(
      readImageDimensions(bytes.subarray(0, bytes.length - 2)),
    ).toBeUndefined();
  });

  it("reads an SOF0 segment ending exactly at the buffer boundary", () => {
    const bytes = concatBytes(SOI, sof0Segment(9, 9));
    expect(readImageDimensions(bytes)).toEqual({ widthPx: 9, heightPx: 9 });
  });

  it("reads an SOF0 segment when the buffer ends immediately after the width field, one byte short of the unread trailing components byte", () => {
    // offset + 7 === bytes.length exactly: every byte the dims reader actually touches is present, with nothing to spare.
    const bytes = concatBytes(SOI, sof0Segment(9, 9));
    expect(readImageDimensions(bytes.subarray(0, bytes.length - 1))).toEqual({
      widthPx: 9,
      heightPx: 9,
    });
  });

  it("returns undefined when no frame header is ever found", () => {
    const bytes = concatBytes(SOI, jpegSegment(0xe0, [1, 2, 3]));
    expect(readImageDimensions(bytes)).toBeUndefined();
  });

  it("never scans a non-JPEG buffer for an embedded marker pattern (wrong first byte)", () => {
    // If the leading-SOI check on byte 0 were bypassed, the walk would still start at offset 2 and find this real-looking SOF0 segment sitting there by construction.
    const bytes = concatBytes([0x00, 0xd8], sof0Segment(5, 6));
    expect(readImageDimensions(bytes)).toBeUndefined();
  });

  it("never scans a non-JPEG buffer for an embedded marker pattern (wrong second byte)", () => {
    const bytes = concatBytes([0xff, 0x00], sof0Segment(5, 6));
    expect(readImageDimensions(bytes)).toBeUndefined();
  });
});
