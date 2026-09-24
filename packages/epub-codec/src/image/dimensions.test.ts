import { describe, expect, it } from "vitest";
import {
  detectImageFormat,
  POINTS_PER_PIXEL,
  readImageDimensions,
} from "./dimensions";

// Mirrors dimensions.ts's own private layout constants so the fixtures below stay tied to the format's real structure rather than restating its offsets as independent literals. Kept local rather than imported: these are dimensions.ts's own implementation details, not part of its public contract.
const PNG_SIG_HIGH_BIT_MARKER = 0x89;
const PNG_SIG_P = 0x50;
const PNG_SIG_N = 0x4e;
const PNG_SIG_G = 0x47;
const PNG_SIG_CR = 0x0d;
const PNG_SIG_LF = 0x0a;
const PNG_SIG_LINE_ENDING_DETECTOR = 0x1a;
const PNG_SIG = [
  PNG_SIG_HIGH_BIT_MARKER,
  PNG_SIG_P,
  PNG_SIG_N,
  PNG_SIG_G,
  PNG_SIG_CR,
  PNG_SIG_LF,
  PNG_SIG_LINE_ENDING_DETECTOR,
  PNG_SIG_LF,
];

const IHDR_TAG_I = 0x49;
const IHDR_TAG_H = 0x48;
const IHDR_TAG_D = 0x44;
const IHDR_TAG_R = 0x52;
const IHDR_TAG_BYTES = [IHDR_TAG_I, IHDR_TAG_H, IHDR_TAG_D, IHDR_TAG_R];

const UINT32_BYTES = 4;

const PNG_CHUNK_TYPE_OFFSET = PNG_SIG.length + UINT32_BYTES; // 12: right after the signature and the chunk's own length field.
const PNG_IHDR_WIDTH_OFFSET = PNG_CHUNK_TYPE_OFFSET + UINT32_BYTES; // 16
const PNG_IHDR_HEIGHT_OFFSET = PNG_IHDR_WIDTH_OFFSET + UINT32_BYTES; // 20
const PNG_HEADER_BYTES = PNG_IHDR_HEIGHT_OFFSET + UINT32_BYTES; // 24: the minimum a PNG needs before its own dimensions are readable, matching dimensions.ts's own PNG_HEADER_BYTES.

// IHDR's own remaining fixed-size fields after width/height, one byte each: bit depth, colour type, compression method, filter method, interlace method. None of these five is read by dimensions.ts, so their values here don't matter beyond being present.
const IHDR_TRAILING_FIELD_BYTES = 5;
const PNG_IHDR_CHUNK_DATA_BYTES =
  UINT32_BYTES + UINT32_BYTES + IHDR_TRAILING_FIELD_BYTES; // 13: width + height + the five trailing fields.
// A real PNG's IHDR chunk ends with a 4-byte CRC that dimensions.ts never reads; left as zero bytes here.
const FAKE_PNG_TOTAL_BYTES =
  PNG_HEADER_BYTES + IHDR_TRAILING_FIELD_BYTES + UINT32_BYTES; // 33
const PNG_BIT_DEPTH_8 = 8;
const PNG_COLOUR_TYPE_TRUECOLOR_ALPHA = 6;

// A minimal PNG carrying only what this module reads: the 8-byte signature plus an IHDR chunk (length, type, width, height, and the five remaining bytes IHDR requires, bit depth, colour type, compression, filter, interlace, whose values don't matter to a dimensions-only reader). No IDAT/IEND: this module never walks past IHDR.
function fakePng(widthPx: number, heightPx: number): Uint8Array {
  const bytes = new Uint8Array(FAKE_PNG_TOTAL_BYTES);
  bytes.set(PNG_SIG, 0); // signature
  const view = new DataView(bytes.buffer);
  view.setUint32(PNG_SIG.length, PNG_IHDR_CHUNK_DATA_BYTES); // IHDR chunk data length
  bytes.set(IHDR_TAG_BYTES, PNG_CHUNK_TYPE_OFFSET); // 'IHDR'
  view.setUint32(PNG_IHDR_WIDTH_OFFSET, widthPx);
  view.setUint32(PNG_IHDR_HEIGHT_OFFSET, heightPx);
  bytes.set(
    [PNG_BIT_DEPTH_8, PNG_COLOUR_TYPE_TRUECOLOR_ALPHA, 0, 0, 0],
    PNG_HEADER_BYTES,
  ); // bit depth, colour type, compression, filter, interlace
  return bytes;
}

const JPEG_MARKER_PREFIX = 0xff;
const JPEG_MARKER_SOI = 0xd8; // Start Of Image.
const JPEG_MARKER_SOF0 = 0xc0; // Baseline Start-Of-Frame.
const JPEG_MARKER_DHT = 0xc4; // Define Huffman Table, not a frame header.
const JPEG_MARKER_JPG_RESERVED = 0xc8; // JPG, reserved, not a frame header.
const JPEG_MARKER_DAC = 0xcc; // Define Arithmetic Coding conditioning, not a frame header.
const JPEG_MARKER_RST0 = 0xd0;
const JPEG_MARKER_RST7 = 0xd7;
const JPEG_MARKER_TEM = 0x01; // Temporary marker, reserved, no length field.
const JPEG_MARKER_EOI = 0xd9; // End Of Image, no length field.
const JPEG_MARKER_SOS = 0xda; // Start Of Scan.
const JPEG_MARKER_APP0 = 0xe0;
const JPEG_MARKER_BELOW_SOF_RANGE = 0xbf; // One below the Start-Of-Frame range's own low end.
const JPEG_MARKER_SOF_HIGH_END = 0xcf; // The Start-Of-Frame range's own high end.
const JPEG_PRECISION_8 = 8; // Bits per sample, baseline JPEG's only legal value.
const JPEG_SOI_BYTES = 2;
const JPEG_MARKER_HEADER_BYTES = 2; // The 0xFF prefix plus the marker byte itself.
const JPEG_SEGMENT_LENGTH_FIELD_BYTES = 2;
const JPEG_PRECISION_FIELD_BYTES = 1;
const JPEG_DIMENSION_FIELD_BYTES = 2;
const JPEG_COMPONENTS_FIELD_BYTES = 1;
// A segment's own declared length counts the two length bytes themselves, so SOF0's is precision + height + width + components + the length field's own two bytes.
const JPEG_SOF0_SEGMENT_LENGTH =
  JPEG_SEGMENT_LENGTH_FIELD_BYTES +
  JPEG_PRECISION_FIELD_BYTES +
  JPEG_DIMENSION_FIELD_BYTES +
  JPEG_DIMENSION_FIELD_BYTES +
  JPEG_COMPONENTS_FIELD_BYTES;

// A minimal baseline JPEG: SOI, then an SOF0 segment carrying height/width/components, nothing past it.
function fakeJpeg(widthPx: number, heightPx: number): Uint8Array {
  const bytes = new Uint8Array(
    JPEG_SOI_BYTES + JPEG_MARKER_HEADER_BYTES + JPEG_SOF0_SEGMENT_LENGTH,
  );
  let offset = 0;
  bytes.set([JPEG_MARKER_PREFIX, JPEG_MARKER_SOI], offset); // SOI
  offset += JPEG_SOI_BYTES;
  bytes.set([JPEG_MARKER_PREFIX, JPEG_MARKER_SOF0], offset); // SOF0
  offset += JPEG_MARKER_HEADER_BYTES;
  const view = new DataView(bytes.buffer);
  view.setUint16(offset, JPEG_SOF0_SEGMENT_LENGTH); // segment length (includes these 2 bytes)
  offset += JPEG_SEGMENT_LENGTH_FIELD_BYTES;
  bytes[offset] = JPEG_PRECISION_8; // precision
  offset += JPEG_PRECISION_FIELD_BYTES;
  view.setUint16(offset, heightPx);
  offset += JPEG_DIMENSION_FIELD_BYTES;
  view.setUint16(offset, widthPx);
  offset += JPEG_DIMENSION_FIELD_BYTES;
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
    // 'GIF', an EPUB-legal image format this module has no representation for.
    const gifTagG = 0x47;
    const gifTagI = 0x49;
    const gifTagF = 0x46;
    expect(
      detectImageFormat(new Uint8Array([gifTagG, gifTagI, gifTagF])),
    ).toBeUndefined();
  });
});

describe("readImageDimensions", () => {
  it("reads PNG width/height from IHDR", () => {
    const widthPx = 640;
    const heightPx = 480;
    expect(readImageDimensions(fakePng(widthPx, heightPx))).toEqual({
      widthPx,
      heightPx,
    });
  });

  it("reads JPEG width/height from SOF0", () => {
    const widthPx = 800;
    const heightPx = 600;
    expect(readImageDimensions(fakeJpeg(widthPx, heightPx))).toEqual({
      widthPx,
      heightPx,
    });
  });

  it("returns undefined for a truncated PNG", () => {
    const truncatedLength = 10;
    expect(
      readImageDimensions(fakePng(1, 1).subarray(0, truncatedLength)),
    ).toBeUndefined();
  });

  it("returns undefined for neither format", () => {
    expect(
      readImageDimensions(new Uint8Array([0x00, 0x01, 0x02])),
    ).toBeUndefined();
  });
});

describe("POINTS_PER_PIXEL", () => {
  it("is the CSS reference-pixel ratio (72/96)", () => {
    const expectedRatio = 0.75;
    expect(POINTS_PER_PIXEL).toBeCloseTo(expectedRatio);
  });
});

// A generic JPEG marker segment: FF, the marker byte, then a big-endian length (including these two length bytes themselves) followed by (length - 2) payload bytes. Used to build multi-segment streams the fixed-shape fakeJpeg() above can't express.
function jpegSegment(marker: number, payload: readonly number[]): number[] {
  const length = payload.length + JPEG_SEGMENT_LENGTH_FIELD_BYTES;
  return [
    JPEG_MARKER_PREFIX,
    marker,
    (length >> BITS_PER_BYTE) & BYTE_MASK,
    length & BYTE_MASK,
    ...payload,
  ];
}

const BITS_PER_BYTE = 8;
const BYTE_MASK = 0xff;

function concatBytes(...chunks: readonly number[][]): Uint8Array {
  return new Uint8Array(chunks.flat());
}

const SOI = [JPEG_MARKER_PREFIX, JPEG_MARKER_SOI];
// An SOF0 segment carrying only height/width/components: the same shape fakeJpeg() builds inline, expressed as a reusable segment for streams that need other markers around it.
function sof0Segment(widthPx: number, heightPx: number): number[] {
  const components = 1;
  return jpegSegment(JPEG_MARKER_SOF0, [
    JPEG_PRECISION_8, // precision
    (heightPx >> BITS_PER_BYTE) & BYTE_MASK,
    heightPx & BYTE_MASK,
    (widthPx >> BITS_PER_BYTE) & BYTE_MASK,
    widthPx & BYTE_MASK,
    components,
  ]);
}

describe("detectImageFormat boundary cases", () => {
  it("recognises a bare 8-byte PNG signature with no IHDR at all", () => {
    expect(detectImageFormat(new Uint8Array(PNG_SIG))).toBe("png");
  });

  it("does not treat a partially-matching 8-byte array as PNG", () => {
    // Only byte 0 matches the real signature: .some() would wrongly accept this, .every() correctly rejects it.
    const bytes = new Uint8Array([
      PNG_SIG_HIGH_BIT_MARKER,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
    expect(detectImageFormat(bytes)).toBeUndefined();
  });

  it("recognises a bare 2-byte JPEG SOI with nothing else", () => {
    expect(detectImageFormat(new Uint8Array(SOI))).toBe("jpeg");
  });

  it("does not treat a single 0xff byte as JPEG", () => {
    expect(
      detectImageFormat(new Uint8Array([JPEG_MARKER_PREFIX])),
    ).toBeUndefined();
  });

  it("does not treat 0xff followed by the wrong second byte as JPEG", () => {
    expect(
      detectImageFormat(new Uint8Array([JPEG_MARKER_PREFIX, 0x00])),
    ).toBeUndefined();
  });

  it("does not treat the wrong first byte followed by 0xd8 as JPEG", () => {
    expect(
      detectImageFormat(new Uint8Array([0x00, JPEG_MARKER_SOI])),
    ).toBeUndefined();
  });
});

describe("readImageDimensions PNG IHDR boundary cases", () => {
  it("reads dimensions from an IHDR ending exactly at the 24-byte minimum", () => {
    const widthPx = 1;
    const heightPx = 1;
    expect(
      readImageDimensions(
        fakePng(widthPx, heightPx).subarray(0, PNG_HEADER_BYTES),
      ),
    ).toEqual({ widthPx, heightPx });
  });

  it("returns undefined one byte short of the 24-byte IHDR minimum", () => {
    expect(
      readImageDimensions(fakePng(1, 1).subarray(0, PNG_HEADER_BYTES - 1)),
    ).toBeUndefined();
  });

  // Arbitrary, unrelated to any boundary being tested: only the IHDR tag byte each sub-test corrupts matters.
  const arbitraryWidthPx = 10;
  const arbitraryHeightPx = 20;
  const thirdTagByteIndex = 3;

  it("rejects an IHDR chunk whose type byte 0 is wrong", () => {
    const bytes = fakePng(arbitraryWidthPx, arbitraryHeightPx);
    bytes[PNG_CHUNK_TYPE_OFFSET] = 0x00;
    expect(readImageDimensions(bytes)).toBeUndefined();
  });

  it("rejects an IHDR chunk whose type byte 1 is wrong", () => {
    const bytes = fakePng(arbitraryWidthPx, arbitraryHeightPx);
    bytes[PNG_CHUNK_TYPE_OFFSET + 1] = 0x00;
    expect(readImageDimensions(bytes)).toBeUndefined();
  });

  it("rejects an IHDR chunk whose type byte 2 is wrong", () => {
    const bytes = fakePng(arbitraryWidthPx, arbitraryHeightPx);
    bytes[PNG_CHUNK_TYPE_OFFSET + 2] = 0x00;
    expect(readImageDimensions(bytes)).toBeUndefined();
  });

  it("rejects an IHDR chunk whose type byte 3 is wrong", () => {
    const bytes = fakePng(arbitraryWidthPx, arbitraryHeightPx);
    bytes[PNG_CHUNK_TYPE_OFFSET + thirdTagByteIndex] = 0x00;
    expect(readImageDimensions(bytes)).toBeUndefined();
  });
});

describe("readImageDimensions JPEG marker-walking", () => {
  // The width/height most of the marker-walking tests below probe with: arbitrary and unrelated to any boundary being tested, so one shared pair stands in for all of them.
  const probeWidthPx = 11;
  const probeHeightPx = 22;

  it("skips a leading run of 0xff fill bytes before the real marker", () => {
    const fillWidthPx = 50;
    const fillHeightPx = 60;
    const bytes = concatBytes(
      SOI,
      [JPEG_MARKER_PREFIX, JPEG_MARKER_PREFIX, JPEG_MARKER_PREFIX],
      sof0Segment(fillWidthPx, fillHeightPx),
    );
    expect(readImageDimensions(bytes)).toEqual({
      widthPx: fillWidthPx,
      heightPx: fillHeightPx,
    });
  });

  it("skips a non-0xff stray byte between segments", () => {
    const fillWidthPx = 50;
    const fillHeightPx = 60;
    const bytes = concatBytes(
      SOI,
      [0x00],
      sof0Segment(fillWidthPx, fillHeightPx),
    );
    expect(readImageDimensions(bytes)).toEqual({
      widthPx: fillWidthPx,
      heightPx: fillHeightPx,
    });
  });

  it("skips two consecutive non-0xff stray bytes, realigning on the real marker rather than misreading the second stray byte as one", () => {
    // A single stray byte happens to still land correctly because the fill-byte loop right after it absorbs the segment's own genuine 0xff. Two non-0xff bytes in a row rules that coincidence out: only advancing offset one byte at a time (rather than jumping straight into marker extraction) reaches the real segment aligned.
    const fillWidthPx = 50;
    const fillHeightPx = 60;
    const secondStrayByte = 0x11;
    const bytes = concatBytes(
      SOI,
      [0x00, secondStrayByte],
      sof0Segment(fillWidthPx, fillHeightPx),
    );
    expect(readImageDimensions(bytes)).toEqual({
      widthPx: fillWidthPx,
      heightPx: fillHeightPx,
    });
  });

  it("skips an APP0 segment by its declared length to reach SOF0", () => {
    // 'JFIF\0', APP0's own conventional payload; its content is never read, only skipped by length.
    const jfifJ = 0x4a;
    const jfifF = 0x46;
    const jfifI = 0x49;
    const app0WidthPx = 70;
    const app0HeightPx = 80;
    const bytes = concatBytes(
      SOI,
      jpegSegment(JPEG_MARKER_APP0, [jfifJ, jfifF, jfifI, jfifF, 0x00]),
      sof0Segment(app0WidthPx, app0HeightPx),
    );
    expect(readImageDimensions(bytes)).toEqual({
      widthPx: app0WidthPx,
      heightPx: app0HeightPx,
    });
  });

  it("skips a restart marker (RST0, no length field) to reach SOF0", () => {
    const bytes = concatBytes(
      SOI,
      [JPEG_MARKER_PREFIX, JPEG_MARKER_RST0],
      sof0Segment(probeWidthPx, probeHeightPx),
    );
    expect(readImageDimensions(bytes)).toEqual({
      widthPx: probeWidthPx,
      heightPx: probeHeightPx,
    });
  });

  it("skips a restart marker (RST7, no length field) to reach SOF0", () => {
    const bytes = concatBytes(
      SOI,
      [JPEG_MARKER_PREFIX, JPEG_MARKER_RST7],
      sof0Segment(probeWidthPx, probeHeightPx),
    );
    expect(readImageDimensions(bytes)).toEqual({
      widthPx: probeWidthPx,
      heightPx: probeHeightPx,
    });
  });

  it("skips a TEM marker (0x01, no length field) to reach SOF0", () => {
    const bytes = concatBytes(
      SOI,
      [JPEG_MARKER_PREFIX, JPEG_MARKER_TEM],
      sof0Segment(probeWidthPx, probeHeightPx),
    );
    expect(readImageDimensions(bytes)).toEqual({
      widthPx: probeWidthPx,
      heightPx: probeHeightPx,
    });
  });

  it("skips an EOI marker (0xd9, no length field) to reach a later SOF0", () => {
    const bytes = concatBytes(
      SOI,
      [JPEG_MARKER_PREFIX, JPEG_MARKER_EOI],
      sof0Segment(probeWidthPx, probeHeightPx),
    );
    expect(readImageDimensions(bytes)).toEqual({
      widthPx: probeWidthPx,
      heightPx: probeHeightPx,
    });
  });

  it("recognises SOF0 at the low end of the frame-marker range (0xc0)", () => {
    const lowWidthPx = 1;
    const lowHeightPx = 2;
    const bytes = concatBytes(SOI, sof0Segment(lowWidthPx, lowHeightPx));
    expect(readImageDimensions(bytes)).toEqual({
      widthPx: lowWidthPx,
      heightPx: lowHeightPx,
    });
  });

  it("recognises a frame marker at the high end of the range (0xcf)", () => {
    const highWidthPx = 1;
    const highHeightPx = 2;
    const components = 1;
    const bytes = concatBytes(
      SOI,
      jpegSegment(JPEG_MARKER_SOF_HIGH_END, [
        JPEG_PRECISION_8,
        0,
        highHeightPx,
        0,
        highWidthPx,
        components,
      ]),
    );
    expect(readImageDimensions(bytes)).toEqual({
      widthPx: highWidthPx,
      heightPx: highHeightPx,
    });
  });

  it("does not treat DHT (0xc4) as a frame header, and reads the later real SOF0", () => {
    const fillByte = 0xff;
    const bytes = concatBytes(
      SOI,
      jpegSegment(JPEG_MARKER_DHT, [
        JPEG_PRECISION_8,
        fillByte,
        fillByte,
        fillByte,
        fillByte,
        fillByte,
      ]),
      sof0Segment(probeWidthPx, probeHeightPx),
    );
    expect(readImageDimensions(bytes)).toEqual({
      widthPx: probeWidthPx,
      heightPx: probeHeightPx,
    });
  });

  it("does not treat JPG (0xc8) as a frame header, and reads the later real SOF0", () => {
    const fillByte = 0xff;
    const bytes = concatBytes(
      SOI,
      jpegSegment(JPEG_MARKER_JPG_RESERVED, [
        JPEG_PRECISION_8,
        fillByte,
        fillByte,
        fillByte,
        fillByte,
        fillByte,
      ]),
      sof0Segment(probeWidthPx, probeHeightPx),
    );
    expect(readImageDimensions(bytes)).toEqual({
      widthPx: probeWidthPx,
      heightPx: probeHeightPx,
    });
  });

  it("does not treat DAC (0xcc) as a frame header, and reads the later real SOF0", () => {
    const fillByte = 0xff;
    const bytes = concatBytes(
      SOI,
      jpegSegment(JPEG_MARKER_DAC, [
        JPEG_PRECISION_8,
        fillByte,
        fillByte,
        fillByte,
        fillByte,
        fillByte,
      ]),
      sof0Segment(probeWidthPx, probeHeightPx),
    );
    expect(readImageDimensions(bytes)).toEqual({
      widthPx: probeWidthPx,
      heightPx: probeHeightPx,
    });
  });

  it("does not treat a marker just below the frame-marker range (0xbf) as a frame header", () => {
    const fillByte = 0xff;
    const bytes = concatBytes(
      SOI,
      jpegSegment(JPEG_MARKER_BELOW_SOF_RANGE, [
        fillByte,
        fillByte,
        fillByte,
        fillByte,
        fillByte,
        fillByte,
      ]),
      sof0Segment(probeWidthPx, probeHeightPx),
    );
    expect(readImageDimensions(bytes)).toEqual({
      widthPx: probeWidthPx,
      heightPx: probeHeightPx,
    });
  });

  it("skips a spurious SOI byte (0xd8) reused mid-stream as its own length-less marker", () => {
    const bytes = concatBytes(
      SOI,
      [JPEG_MARKER_PREFIX, JPEG_MARKER_SOI],
      sof0Segment(probeWidthPx, probeHeightPx),
    );
    expect(readImageDimensions(bytes)).toEqual({
      widthPx: probeWidthPx,
      heightPx: probeHeightPx,
    });
  });

  it("stops at SOS (0xda) and never reads a frame header appearing after it", () => {
    const bytes = concatBytes(
      SOI,
      jpegSegment(JPEG_MARKER_SOS, []),
      sof0Segment(probeWidthPx, probeHeightPx),
    );
    expect(readImageDimensions(bytes)).toBeUndefined();
  });

  it("returns undefined when the stream ends with no marker byte after a trailing 0xff", () => {
    const bytes = concatBytes(SOI, [JPEG_MARKER_PREFIX]);
    expect(readImageDimensions(bytes)).toBeUndefined();
  });

  it("returns undefined when a marker's length field is exactly cut off", () => {
    // offset + 2 === bytes.length: the two length bytes themselves are missing.
    const bytes = concatBytes(SOI, [JPEG_MARKER_PREFIX, JPEG_MARKER_APP0]);
    expect(readImageDimensions(bytes)).toBeUndefined();
  });

  it("reads a length field that ends exactly at the buffer boundary", () => {
    // offset + 2 === bytes.length for the length field itself, immediately followed by SOF0.
    const shortSegmentLength = 2;
    const shortWidthPx = 3;
    const shortHeightPx = 4;
    const bytes = concatBytes(
      SOI,
      [JPEG_MARKER_PREFIX, JPEG_MARKER_APP0, 0x00, shortSegmentLength],
      sof0Segment(shortWidthPx, shortHeightPx),
    );
    expect(readImageDimensions(bytes)).toEqual({
      widthPx: shortWidthPx,
      heightPx: shortHeightPx,
    });
  });

  it("returns undefined when an SOF0 segment is missing part of its width field", () => {
    // offset + 7 > bytes.length: two bytes short cuts into the width field the dims reader actually reads (the trailing, unread "components" byte alone isn't enough to trip this guard).
    const cutoffBytes = 2;
    const widthPx = 9;
    const heightPx = 9;
    const bytes = concatBytes(SOI, sof0Segment(widthPx, heightPx));
    expect(
      readImageDimensions(bytes.subarray(0, bytes.length - cutoffBytes)),
    ).toBeUndefined();
  });

  it("reads an SOF0 segment ending exactly at the buffer boundary", () => {
    const widthPx = 9;
    const heightPx = 9;
    const bytes = concatBytes(SOI, sof0Segment(widthPx, heightPx));
    expect(readImageDimensions(bytes)).toEqual({ widthPx, heightPx });
  });

  it("reads an SOF0 segment when the buffer ends immediately after the width field, one byte short of the unread trailing components byte", () => {
    // offset + 7 === bytes.length exactly: every byte the dims reader actually touches is present, with nothing to spare.
    const widthPx = 9;
    const heightPx = 9;
    const cutoffBytes = 1;
    const bytes = concatBytes(SOI, sof0Segment(widthPx, heightPx));
    expect(
      readImageDimensions(bytes.subarray(0, bytes.length - cutoffBytes)),
    ).toEqual({ widthPx, heightPx });
  });

  it("returns undefined when no frame header is ever found", () => {
    // Arbitrary payload: never read, only skipped by length.
    const arbitraryPayload = Array.from({ length: 3 }, (_, index) => index + 1);
    const bytes = concatBytes(
      SOI,
      jpegSegment(JPEG_MARKER_APP0, arbitraryPayload),
    );
    expect(readImageDimensions(bytes)).toBeUndefined();
  });

  it("never scans a non-JPEG buffer for an embedded marker pattern (wrong first byte)", () => {
    // If the leading-SOI check on byte 0 were bypassed, the walk would still start at offset 2 and find this real-looking SOF0 segment sitting there by construction.
    const embeddedWidthPx = 5;
    const embeddedHeightPx = 6;
    const bytes = concatBytes(
      [0x00, JPEG_MARKER_SOI],
      sof0Segment(embeddedWidthPx, embeddedHeightPx),
    );
    expect(readImageDimensions(bytes)).toBeUndefined();
  });

  it("never scans a non-JPEG buffer for an embedded marker pattern (wrong second byte)", () => {
    const embeddedWidthPx = 5;
    const embeddedHeightPx = 6;
    const bytes = concatBytes(
      [JPEG_MARKER_PREFIX, 0x00],
      sof0Segment(embeddedWidthPx, embeddedHeightPx),
    );
    expect(readImageDimensions(bytes)).toBeUndefined();
  });
});
