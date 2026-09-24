import { describe, expect, it } from "vitest";
import { detectImageFormat, readImageDimensions } from "./image";

function bytes(...values: readonly number[]): Uint8Array {
  return new Uint8Array(values);
}

// Mirrors image.ts's own PNG_SIGNATURE/IHDR_TYPE derivation, and its own SOI/EOI marker pair. Kept as spreadable byte arrays rather than named individually: these bytes never vary from test to test and carry no signal of their own.
const PNG_SIGNATURE = [
  0x89,
  ...Array.from("PNG\r\n\x1a\n", (char) => char.charCodeAt(0)),
];
const IHDR_TYPE = Array.from("IHDR", (char) => char.charCodeAt(0));
const SOI = [0xff, 0xd8]; // Start Of Image
const EOI = [0xff, 0xd9]; // End Of Image

// Every remaining marker, length, precision, width, and height byte in this file's own JPEG fixtures stays a literal, deliberately: it is that specific test's own exact payload, and adjacent tests routinely differ from one another by exactly one such byte to exercise one state-machine transition (a truncation point, a fill-byte run, DHT vs SOF, a wrong length field). A parameterised builder covering every one of these deliberately-exact, deliberately-varying shapes would either hide the single-byte difference that gives each test its point, or risk silently changing what a truncation/corruption case actually asserts. See image.ts's own top-of-file comment for the parser these bytes exercise.

describe("readImageDimensions", () => {
  it("reads a PNG IHDR chunk width/height", () => {
    const width = 300;
    const height = 100;
    const png = bytes(
      ...PNG_SIGNATURE,
      0x00,
      0x00,
      0x00,
      0x0d, // IHDR chunk length (13)
      ...IHDR_TYPE,
      0x00,
      0x00,
      0x01,
      0x2c, // width = 300
      0x00,
      0x00,
      0x00,
      0x64, // height = 100
      0x08,
      0x06,
      0x00,
      0x00,
      0x00, // bit depth, color type, compression, filter, interlace
    );
    expect(readImageDimensions(png)).toEqual({
      widthPx: width,
      heightPx: height,
    });
  });

  it("returns undefined for a truncated PNG with no full IHDR", () => {
    const truncated = bytes(...PNG_SIGNATURE, 0x00, 0x00);
    expect(readImageDimensions(truncated)).toBeUndefined();
  });

  it("reads a JPEG SOF0 frame header width/height, skipping a preceding APP0 segment by its own declared length", () => {
    const jpeg = bytes(
      ...SOI,
      0xff,
      0xe0,
      0x00,
      0x04,
      0x41,
      0x42, // APP0, length 4 (2 payload bytes 'A' 'B')
      0xff,
      0xc0,
      0x00,
      0x0b, // SOF0, length 11
      0x08, // precision
      0x00,
      0x10, // height = 16
      0x00,
      0x20, // width = 32
      0x01, // Nf = 1
      0x01,
      0x11,
      0x00, // component 1
      ...EOI,
    );
    expect(readImageDimensions(jpeg)).toEqual({ widthPx: 32, heightPx: 16 });
  });

  it("does not mistake DHT (0xC4) for a frame header despite sharing the SOF numeric range", () => {
    const jpeg = bytes(
      ...SOI,
      0xff,
      0xc4,
      0x00,
      0x05,
      0x00,
      0x01,
      0x02, // DHT, length 5 (3 payload bytes)
      0xff,
      0xc0,
      0x00,
      0x0b, // SOF0, length 11
      0x08,
      0x00,
      0x02,
      0x00,
      0x03,
      0x01,
      0x01,
      0x11,
      0x00,
      ...EOI,
    );
    expect(readImageDimensions(jpeg)).toEqual({ widthPx: 3, heightPx: 2 });
  });

  it("returns undefined for neither a PNG signature nor a JPEG SOI marker", () => {
    expect(readImageDimensions(bytes(0x00, 0x01, 0x02, 0x03))).toBeUndefined();
  });

  it("returns undefined for a JPEG with no frame header before the end of input", () => {
    const jpeg = bytes(...SOI, 0xff, 0xe0, 0x00, 0x02);
    expect(readImageDimensions(jpeg)).toBeUndefined();
  });

  it("reads a PNG whose length is exactly the minimum IHDR-readable size", () => {
    const png = bytes(
      ...PNG_SIGNATURE,
      0x00,
      0x00,
      0x00,
      0x0d,
      ...IHDR_TYPE,
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      0x01,
    );
    const oneByOne = 1;
    expect(readImageDimensions(png)).toEqual({
      widthPx: oneByOne,
      heightPx: oneByOne,
    });
  });

  it("returns undefined for a PNG one byte short of the minimum IHDR-readable size", () => {
    const png = bytes(
      ...PNG_SIGNATURE,
      0x00,
      0x00,
      0x00,
      0x0d,
      ...IHDR_TYPE,
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
    );
    expect(readImageDimensions(png)).toBeUndefined();
  });

  it.each([
    [12, 0x00],
    [13, 0x00],
    [14, 0x00],
    [15, 0x00],
  ])(
    "returns undefined when only byte %i of the 'IHDR' chunk type is wrong",
    (badOffset, badByte) => {
      const values = [
        ...PNG_SIGNATURE,
        0x00,
        0x00,
        0x00,
        0x0d,
        ...IHDR_TYPE,
        0x00,
        0x00,
        0x00,
        0x01,
        0x00,
        0x00,
        0x00,
        0x01,
      ];
      values[badOffset] = badByte;
      expect(readImageDimensions(bytes(...values))).toBeUndefined();
    },
  );

  it("does not mistake JPG (0xC8) for a frame header", () => {
    const jpeg = bytes(
      ...SOI,
      0xff,
      0xc8,
      0x00,
      0x02, // JPG marker, zero-length payload
      0xff,
      0xc0,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x05,
      0x00,
      0x06,
      0x01,
      0x01,
      0x11,
      0x00,
      ...EOI,
    );
    expect(readImageDimensions(jpeg)).toEqual({ widthPx: 6, heightPx: 5 });
  });

  it("does not mistake DAC (0xCC) for a frame header", () => {
    const jpeg = bytes(
      ...SOI,
      0xff,
      0xcc,
      0x00,
      0x03,
      0x00, // DAC, length 3 (1 payload byte)
      0xff,
      0xc0,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x07,
      0x00,
      0x08,
      0x01,
      0x01,
      0x11,
      0x00,
      ...EOI,
    );
    expect(readImageDimensions(jpeg)).toEqual({ widthPx: 8, heightPx: 7 });
  });

  it("reads a SOF2 (progressive) frame header, proving the SOF check isn't hardcoded to 0xC0", () => {
    const jpeg = bytes(
      ...SOI,
      0xff,
      0xc2,
      0x00,
      0x0b, // SOF2
      0x08,
      0x00,
      0x09,
      0x00,
      0x0a,
      0x01,
      0x01,
      0x11,
      0x00,
      ...EOI,
    );
    expect(readImageDimensions(jpeg)).toEqual({ widthPx: 10, heightPx: 9 });
  });

  it("skips a marker preceded by a run of extra 0xFF fill bytes", () => {
    const jpeg = bytes(
      ...SOI,
      0xff,
      0xff,
      0xff,
      0xc0, // fill bytes before the real SOF0 marker
      0x00,
      0x0b,
      0x08,
      0x00,
      0x0c,
      0x00,
      0x0d,
      0x01,
      0x01,
      0x11,
      0x00,
      ...EOI,
    );
    expect(readImageDimensions(jpeg)).toEqual({ widthPx: 13, heightPx: 12 });
  });

  it("returns undefined when a run of fill bytes runs off the end of input with no marker byte following", () => {
    const jpeg = bytes(...SOI, 0xff, 0xff, 0xff);
    expect(readImageDimensions(jpeg)).toBeUndefined();
  });

  it.each([
    [0xd0, "RST0"],
    [0xd7, "RST7"],
    [0x01, "TEM"],
  ])(
    "skips a %s marker (%s) with no length field, continuing to the next marker",
    (marker) => {
      const jpeg = bytes(
        ...SOI,
        0xff,
        marker, // no-length-field marker
        0xff,
        0xc0,
        0x00,
        0x0b,
        0x08,
        0x00,
        0x0e,
        0x00,
        0x0f,
        0x01,
        0x01,
        0x11,
        0x00,
        ...EOI,
      );
      expect(readImageDimensions(jpeg)).toEqual({
        widthPx: 15,
        heightPx: 14,
      });
    },
  );

  it("returns undefined at Start Of Scan (0xDA) with no frame header found first", () => {
    const jpeg = bytes(...SOI, 0xff, 0xda, 0x00, 0x02);
    expect(readImageDimensions(jpeg)).toBeUndefined();
  });

  it("returns undefined when a marker's declared length field is truncated", () => {
    const jpeg = bytes(...SOI, 0xff, 0xe0, 0x00);
    expect(readImageDimensions(jpeg)).toBeUndefined();
  });

  it("returns undefined when a SOF marker's own payload is truncated before height/width", () => {
    const jpeg = bytes(...SOI, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00);
    expect(readImageDimensions(jpeg)).toBeUndefined();
  });

  it("reads a frame header whose payload ends exactly at the last byte of input", () => {
    // Height and width occupy the final four bytes, so the segment is complete with nothing to spare.
    const jpeg = bytes(
      ...SOI,
      0xff,
      0xc0,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x14,
      0x00,
      0x15,
    );
    expect(readImageDimensions(jpeg)).toEqual({ widthPx: 21, heightPx: 20 });
  });

  it("returns undefined for bytes carrying a frame header but no SOI marker at all", () => {
    const notJpeg = bytes(
      0x00,
      0x00,
      0xff,
      0xc0,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x07,
      0x00,
      0x08,
      0x01,
      0x01,
      0x11,
      0x00,
    );
    expect(readImageDimensions(notJpeg)).toBeUndefined();
  });

  it("returns undefined when the 0xFF lead byte is present but the byte completing SOI is not 0xD8", () => {
    const notJpeg = bytes(
      0xff,
      0x00,
      0xff,
      0xc0,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x09,
      0x00,
      0x0a,
      0x01,
      0x01,
      0x11,
      0x00,
    );
    expect(readImageDimensions(notJpeg)).toBeUndefined();
  });

  it("returns undefined when the 0xD8 byte is present but the 0xFF lead of SOI is not", () => {
    const notJpeg = bytes(
      0x00,
      0xd8,
      0xff,
      0xc0,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x0b,
      0x00,
      0x0c,
      0x01,
      0x01,
      0x11,
      0x00,
    );
    expect(readImageDimensions(notJpeg)).toBeUndefined();
  });

  it("skips a marker below the Start-Of-Frame range by its own declared length", () => {
    // 0xBF is reserved and carries a length field, so its payload is skipped whole rather than read as a frame header.
    const jpeg = bytes(
      ...SOI,
      0xff,
      0xbf,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x01,
      0x00,
      0x02,
      0x01,
      0x01,
      0x11,
      0x00,
      0xff,
      0xc0,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x03,
      0x00,
      0x04,
      0x01,
      0x01,
      0x11,
      0x00,
      ...EOI,
    );
    expect(readImageDimensions(jpeg)).toEqual({ widthPx: 4, heightPx: 3 });
  });

  it("reads a SOF15 (0xCF) frame header, the last marker of the Start-Of-Frame range", () => {
    const jpeg = bytes(
      ...SOI,
      0xff,
      0xcf,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x05,
      0x00,
      0x06,
      0x01,
      0x01,
      0x11,
      0x00,
      ...EOI,
    );
    expect(readImageDimensions(jpeg)).toEqual({ widthPx: 6, heightPx: 5 });
  });

  it("skips a second SOI marker, which carries no length field of its own", () => {
    const jpeg = bytes(
      ...SOI,
      0xff,
      0xd8,
      0xff,
      0xc0,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x07,
      0x00,
      0x08,
      0x01,
      0x01,
      0x11,
      0x00,
      ...EOI,
    );
    expect(readImageDimensions(jpeg)).toEqual({ widthPx: 8, heightPx: 7 });
  });

  it("skips an EOI marker appearing before the frame header, which carries no length field of its own", () => {
    const jpeg = bytes(
      ...SOI,
      0xff,
      0xd9,
      0xff,
      0xc0,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x09,
      0x00,
      0x0a,
      0x01,
      0x01,
      0x11,
      0x00,
      ...EOI,
    );
    expect(readImageDimensions(jpeg)).toEqual({ widthPx: 10, heightPx: 9 });
  });

  it("skips a DQT segment by its declared length rather than scanning through its payload", () => {
    // The quantisation table's payload deliberately spells out a frame header, which must not be mistaken for the real one that follows the segment.
    const jpeg = bytes(
      ...SOI,
      0xff,
      0xdb,
      0x00,
      0x0b,
      0xff,
      0xc0,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x01,
      0x00,
      0x02,
      0xff,
      0xc0,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x03,
      0x00,
      0x04,
      0x01,
      0x01,
      0x11,
      0x00,
      ...EOI,
    );
    expect(readImageDimensions(jpeg)).toEqual({ widthPx: 4, heightPx: 3 });
  });

  it("resumes scanning from the next 0xFF when a segment's declared length lands between markers", () => {
    // The APP0 segment declares one payload byte but two more follow it, so the walk lands on a byte that begins no marker.
    const jpeg = bytes(
      ...SOI,
      0xff,
      0xe0,
      0x00,
      0x03,
      0x41,
      0x42,
      0x43,
      0xff,
      0xc0,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x0b,
      0x00,
      0x0c,
      0x01,
      0x01,
      0x11,
      0x00,
      ...EOI,
    );
    expect(readImageDimensions(jpeg)).toEqual({ widthPx: 12, heightPx: 11 });
  });

  it("returns undefined for a frame-header-shaped run inside the scan data after Start Of Scan", () => {
    const jpeg = bytes(
      ...SOI,
      0xff,
      0xda,
      0x00,
      0x02,
      0xff,
      0xc0,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x16,
      0x00,
      0x17,
      0x01,
      0x01,
      0x11,
      0x00,
      ...EOI,
    );
    expect(readImageDimensions(jpeg)).toBeUndefined();
  });
});

describe("detectImageFormat", () => {
  it("detects a PNG signature", () => {
    expect(
      detectImageFormat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBe("png");
  });

  it("detects a JPEG SOI marker", () => {
    expect(detectImageFormat(bytes(...SOI, 0xff, 0xe0))).toBe("jpeg");
  });

  it("returns undefined for neither a PNG nor a JPEG", () => {
    expect(detectImageFormat(bytes(0x00, 0x01, 0x02, 0x03))).toBeUndefined();
  });

  it("returns undefined for an empty input", () => {
    expect(detectImageFormat(bytes())).toBeUndefined();
  });

  it("returns undefined for bytes sharing only the leading byte of the PNG signature", () => {
    expect(
      detectImageFormat(bytes(0x89, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00)),
    ).toBeUndefined();
  });

  it("detects a two-byte input that is exactly the SOI marker", () => {
    expect(detectImageFormat(bytes(...SOI))).toBe("jpeg");
  });

  it("returns undefined for the 0xD8 of SOI without its 0xFF lead byte", () => {
    expect(detectImageFormat(bytes(0x00, 0xd8))).toBeUndefined();
  });

  it("returns undefined for the 0xFF lead byte of SOI without the 0xD8 that completes it", () => {
    expect(detectImageFormat(bytes(0xff, 0x00))).toBeUndefined();
  });
});
