import { describe, expect, it } from "vitest";
import { readJpegInfo } from "./jpeg-info";

// Builds a minimal, spec-shaped JPEG byte stream from a list of marker segments, each either a bare marker byte (for SOI/EOI/restart/TEM, which carry no length or payload) or a marker plus a payload whose length is computed and written automatically (the 2 length bytes count themselves, per the JPEG marker-segment format).
type Segment =
  | { readonly marker: number }
  | { readonly marker: number; readonly payload: readonly number[] };

function buildJpeg(segments: readonly Segment[]): Uint8Array<ArrayBuffer> {
  const bytes: number[] = [];
  for (const segment of segments) {
    bytes.push(0xff, segment.marker);
    if ("payload" in segment) {
      const length = segment.payload.length + 2;
      bytes.push((length >> 8) & 0xff, length & 0xff, ...segment.payload);
    }
  }
  return new Uint8Array(bytes);
}

// A baseline (SOF0) frame header payload: precision, height (2 bytes BE), width (2 bytes BE), component count. No per-component data, since readJpegInfo never reads past componentCount.
function sof0Payload(
  width: number,
  height: number,
  components: number,
  precision = 8,
): readonly number[] {
  return [
    precision,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    components,
  ];
}

describe("readJpegInfo: SOI validation", () => {
  it("throws for an empty buffer, which has no SOI marker at all", () => {
    expect(() => readJpegInfo(new Uint8Array(0))).toThrow(
      "unexpected end of JPEG data",
    );
  });

  it("throws when the first byte is not 0xff", () => {
    expect(() => readJpegInfo(new Uint8Array([0x00, 0xd8]))).toThrow(
      "not a valid JPEG file: missing SOI marker",
    );
  });

  it("throws when the first byte is 0xff but the second is not the SOI marker", () => {
    expect(() => readJpegInfo(new Uint8Array([0xff, 0x00]))).toThrow(
      "not a valid JPEG file: missing SOI marker",
    );
  });

  it("throws for a truncated single-byte buffer, since the SOI check reads two bytes", () => {
    expect(() => readJpegInfo(new Uint8Array([0xff]))).toThrow(
      "unexpected end of JPEG data",
    );
  });
});

describe("readJpegInfo: baseline SOF0", () => {
  it("reads width, height, components and precision from a baseline frame", () => {
    const jpeg = buildJpeg([
      { marker: 0xd8 }, // SOI
      { marker: 0xc0, payload: sof0Payload(640, 480, 3) }, // SOF0
    ]);
    const info = readJpegInfo(jpeg);
    expect(info.width).toBe(640);
    expect(info.height).toBe(480);
    expect(info.components).toBe(3);
    expect(info.precision).toBe(8);
  });

  it("reads a 12-bit precision and single-component (grayscale) frame exactly", () => {
    const jpeg = buildJpeg([
      { marker: 0xd8 },
      { marker: 0xc0, payload: sof0Payload(16, 9, 1, 12) },
    ]);
    const info = readJpegInfo(jpeg);
    expect(info.precision).toBe(12);
    expect(info.components).toBe(1);
    expect(info.width).toBe(16);
    expect(info.height).toBe(9);
  });

  it("distinguishes width from height rather than transposing them", () => {
    const jpeg = buildJpeg([
      { marker: 0xd8 },
      { marker: 0xc0, payload: sof0Payload(300, 7, 3) },
    ]);
    const info = readJpegInfo(jpeg);
    expect(info.width).toBe(300);
    expect(info.height).toBe(7);
  });

  it("reports progressive: false for a baseline frame", () => {
    const jpeg = buildJpeg([
      { marker: 0xd8 },
      { marker: 0xc0, payload: sof0Payload(10, 10, 3) },
    ]);
    expect(readJpegInfo(jpeg).progressive).toBe(false);
  });

  it("reports adobeTransform as undefined when no APP14 marker is present", () => {
    const jpeg = buildJpeg([
      { marker: 0xd8 },
      { marker: 0xc0, payload: sof0Payload(10, 10, 3) },
    ]);
    expect(readJpegInfo(jpeg).adobeTransform).toBeUndefined();
  });
});

describe("readJpegInfo: every recognised SOF marker", () => {
  it.each([
    ["SOF0 (baseline)", 0xc0, false],
    ["SOF1 (extended sequential Huffman)", 0xc1, false],
    ["SOF2 (progressive Huffman)", 0xc2, true],
    ["SOF9 (extended sequential arithmetic)", 0xc9, false],
    ["SOF10 (progressive arithmetic)", 0xca, true],
  ])(
    "recognises %s and reports progressive=%s",
    (_label, marker, progressive) => {
      const jpeg = buildJpeg([
        { marker: 0xd8 },
        { marker, payload: sof0Payload(20, 20, 3) },
      ]);
      const info = readJpegInfo(jpeg);
      expect(info.width).toBe(20);
      expect(info.progressive).toBe(progressive);
    },
  );

  it("does not treat an unrelated marker as a SOF and continues scanning past it", () => {
    const jpeg = buildJpeg([
      { marker: 0xd8 },
      { marker: 0xdb, payload: [0, 1, 2, 3] }, // DQT: some other marker with a payload
      { marker: 0xc0, payload: sof0Payload(50, 60, 3) },
    ]);
    const info = readJpegInfo(jpeg);
    expect(info.width).toBe(50);
    expect(info.height).toBe(60);
  });
});

describe("readJpegInfo: markers with no payload", () => {
  it.each([
    ["TEM", 0x01],
    ["restart marker RST0", 0xd0],
    ["restart marker RST7", 0xd7],
  ])(
    "skips a no-payload marker (%s) without misreading a length",
    (_label, marker) => {
      const jpeg = buildJpeg([
        { marker: 0xd8 },
        { marker },
        { marker: 0xc0, payload: sof0Payload(11, 22, 3) },
      ]);
      const info = readJpegInfo(jpeg);
      expect(info.width).toBe(11);
      expect(info.height).toBe(22);
    },
  );

  it("stops scanning at an EOI marker and throws when no SOF was found first", () => {
    const jpeg = buildJpeg([{ marker: 0xd8 }, { marker: 0xd9 }]);
    expect(() => readJpegInfo(jpeg)).toThrow(
      "no SOF marker found in JPEG file",
    );
  });

  it("stops scanning at EOI even when a well-formed SOF marker follows it", () => {
    // A genuinely valid SOF0 segment placed after EOI must never be reached: EOI ends the scan.
    const jpeg = buildJpeg([
      { marker: 0xd8 },
      { marker: 0xd9 }, // EOI
      { marker: 0xc0, payload: sof0Payload(77, 88, 3) },
    ]);
    expect(() => readJpegInfo(jpeg)).toThrow(
      "no SOF marker found in JPEG file",
    );
  });
});

describe("readJpegInfo: marker padding and scanning", () => {
  it("skips fill bytes (0xff padding) before a real marker code", () => {
    const jpeg = new Uint8Array([
      0xff,
      0xd8, // SOI
      0xff,
      0xff,
      0xff,
      0xc0, // SOF0, preceded by 0xff padding
      0,
      8, // segment length = 8
      ...sof0Payload(5, 6, 3),
    ]);
    const info = readJpegInfo(jpeg);
    expect(info.width).toBe(5);
    expect(info.height).toBe(6);
  });

  it("advances past a stray non-0xff byte between markers rather than misreading it as one", () => {
    const jpeg = new Uint8Array([
      0xff,
      0xd8, // SOI
      0x00, // stray byte, not a marker lead-in
      0xff,
      0xc0,
      0,
      8,
      ...sof0Payload(9, 9, 3),
    ]);
    const info = readJpegInfo(jpeg);
    expect(info.width).toBe(9);
  });

  it("throws when the byte stream ends right after a marker's 0xff lead-in with nothing after it", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);
    expect(() => readJpegInfo(jpeg)).toThrow(
      "no SOF marker found in JPEG file",
    );
  });

  it("stops once the scan runs out of bytes entirely, with no EOI and no marker lead-in to end on", () => {
    // Trailing non-marker bytes with nothing after them: the scan advances one byte at a time and must stop when there is no byte left to read at all, rather than continuing past the end of the buffer.
    const jpeg = new Uint8Array([0xff, 0xd8, 0x00, 0x00]);
    expect(() => readJpegInfo(jpeg)).toThrow(
      "no SOF marker found in JPEG file",
    );
  });

  it("must genuinely skip a non-0xff byte rather than treat its own position as a marker lead-in", () => {
    // If the non-0xff skip were disabled, position 2 (0xab) would itself be read as if it led a marker: markerOffset=3 lands on 0xc0 (a real SOF0 code, but here just incidental scan bytes), and the encoder would misparse the following junk bytes as a bogus SOF payload -- returning wildly wrong dimensions instead of ever reaching the real, later SOF0 segment.
    const bogusIfMisparsed = [1, 2, 3, 4, 5, 6];
    const jpeg = new Uint8Array([
      0xff,
      0xd8, // SOI
      0xab, // stray byte -- must be skipped one at a time, not treated as a lead-in
      0xc0, // NOT preceded by a real 0xff here -- just incidental non-marker bytes
      0,
      8,
      ...bogusIfMisparsed,
      0xff,
      0xc0, // the real, correctly-framed SOF0
      0,
      8,
      ...sof0Payload(99, 88, 3),
    ]);
    const info = readJpegInfo(jpeg);
    expect(info.width).toBe(99);
    expect(info.height).toBe(88);
  });
});

describe("readJpegInfo: Adobe APP14 transform", () => {
  function app14Payload(transform: number): readonly number[] {
    // "Adobe" (5 ASCII bytes) + version (2 bytes) + flags0 (2 bytes) + flags1 (2 bytes) + transform (1 byte) = 12 bytes; the transform byte lives at offset 11 within the segment (2 length bytes + 11), matching offset + 2 + 11 in the source.
    return [
      0x41,
      0x64,
      0x6f,
      0x62,
      0x65, // "Adobe"
      0,
      100, // version
      0,
      0, // flags0
      0,
      0, // flags1
      transform,
    ];
  }

  it("reads the Adobe transform byte when the APP14 segment is at least 14 bytes", () => {
    const jpeg = buildJpeg([
      { marker: 0xd8 },
      { marker: 0xee, payload: app14Payload(2) }, // APP14, segment length 14
      { marker: 0xc0, payload: sof0Payload(4, 4, 4) },
    ]);
    expect(readJpegInfo(jpeg).adobeTransform).toBe(2);
  });

  it("distinguishes transform value 0 from 'absent' rather than treating it as falsy/undefined", () => {
    const jpeg = buildJpeg([
      { marker: 0xd8 },
      { marker: 0xee, payload: app14Payload(0) },
      { marker: 0xc0, payload: sof0Payload(4, 4, 4) },
    ]);
    expect(readJpegInfo(jpeg).adobeTransform).toBe(0);
  });

  it("never reads an Adobe transform from a non-APP14 marker, even one with a payload at least 14 bytes long", () => {
    // A DQT (0xdb) segment carrying a 14-byte payload -- the same length threshold APP14 uses -- but the wrong marker code entirely. Only APP14 segments carry an Adobe transform byte.
    const jpeg = buildJpeg([
      { marker: 0xd8 },
      { marker: 0xdb, payload: app14Payload(2) }, // 14-byte payload, but not APP14
      { marker: 0xc0, payload: sof0Payload(4, 4, 4) },
    ]);
    expect(readJpegInfo(jpeg).adobeTransform).toBeUndefined();
  });

  it("does not read the Adobe transform when the APP14 segment is shorter than 14 bytes", () => {
    const jpeg = buildJpeg([
      { marker: 0xd8 },
      // A 13-byte APP14 segment (one byte short of the 14-byte minimum this reader requires).
      {
        marker: 0xee,
        payload: [0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, 0, 0],
      },
      { marker: 0xc0, payload: sof0Payload(4, 4, 4) },
    ]);
    expect(readJpegInfo(jpeg).adobeTransform).toBeUndefined();
  });

  it("treats a segment of exactly 14 bytes as long enough to read the transform byte", () => {
    // segmentLength >= 14 (not > 14): the boundary case where the segment is exactly at the minimum.
    const jpeg = buildJpeg([
      { marker: 0xd8 },
      { marker: 0xee, payload: app14Payload(1) }, // length = 12 (payload) + 2 = 14
      { marker: 0xc0, payload: sof0Payload(4, 4, 4) },
    ]);
    expect(readJpegInfo(jpeg).adobeTransform).toBe(1);
  });
});

describe("readJpegInfo: unexpected end of data", () => {
  it("throws when a marker's own 2-byte length field is itself truncated", () => {
    const jpeg = new Uint8Array([
      0xff,
      0xd8, // SOI
      0xff,
      0xdb, // DQT
      0, // only the first of the 2 length bytes is present
    ]);
    expect(() => readJpegInfo(jpeg)).toThrow("unexpected end of JPEG data");
  });

  it("throws when the SOF segment itself is truncated before its component count byte", () => {
    const jpeg = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xc0,
      0,
      7, // declares just enough length for precision+height+width but not components
      8,
      0,
      10,
      0,
      10,
    ]);
    expect(() => readJpegInfo(jpeg)).toThrow("unexpected end of JPEG data");
  });
});
