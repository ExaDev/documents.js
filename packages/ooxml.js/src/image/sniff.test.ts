import { describe, expect, it } from "vitest";
import { PNG_SIGNATURE, sniffImageFormat } from "./sniff";

function enc(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

describe("sniffImageFormat: PNG", () => {
  it("detects a genuine PNG signature", () => {
    // The genuine PNG signature followed by three arbitrary trailing bytes standing in for whatever real image data would normally follow it: their exact values carry no meaning, so they simply count upward.
    const ARBITRARY_TRAILING_BYTE_COUNT = 3;
    const bytes = new Uint8Array([
      ...PNG_SIGNATURE,
      ...Array.from(
        { length: ARBITRARY_TRAILING_BYTE_COUNT },
        (_unused, index) => index + 1,
      ),
    ]);
    expect(sniffImageFormat(bytes)).toBe("png");
  });

  it("does not match a truncated PNG signature (shorter than the real one)", () => {
    // The genuine signature's own first four bytes, with the rest missing entirely rather than corrupted.
    const TRUNCATED_PNG_SIGNATURE_LENGTH = 4;
    const bytes = new Uint8Array(
      PNG_SIGNATURE.slice(0, TRUNCATED_PNG_SIGNATURE_LENGTH),
    );
    expect(sniffImageFormat(bytes)).toBeUndefined();
  });

  it("does not match bytes that agree with the PNG signature's prefix but diverge partway through", () => {
    // Every byte before and after this index matches PNG_SIGNATURE exactly; only the CR byte (0x0d) at this position is deliberately wrong.
    const PNG_SIGNATURE_CR_BYTE_INDEX = 4;
    const PNG_SIGNATURE_CR_BYTE_CORRUPTED = 0x00;
    const bytes = new Uint8Array([
      ...PNG_SIGNATURE.slice(0, PNG_SIGNATURE_CR_BYTE_INDEX),
      PNG_SIGNATURE_CR_BYTE_CORRUPTED,
      ...PNG_SIGNATURE.slice(PNG_SIGNATURE_CR_BYTE_INDEX + 1),
    ]);
    expect(sniffImageFormat(bytes)).toBeUndefined();
  });
});

describe("sniffImageFormat: JPEG", () => {
  // Mirrors sniff.ts's own (unexported) JPEG_MARKER_PREFIX/JPEG_SOI_MARKER: every JPEG marker starts with 0xff, and SOI (Start Of Image, 0xd8) is always the file's first marker.
  const JPEG_MARKER_PREFIX = 0xff;
  const JPEG_SOI_MARKER = 0xd8;

  it("detects a genuine JPEG signature", () => {
    // The genuine three-byte signature, followed by a realistic fourth byte (JFIF's own APP0 marker id) that sniffImageFormat never actually inspects.
    const JPEG_APP0_MARKER = 0xe0;
    expect(
      sniffImageFormat(
        new Uint8Array([
          JPEG_MARKER_PREFIX,
          JPEG_SOI_MARKER,
          JPEG_MARKER_PREFIX,
          JPEG_APP0_MARKER,
        ]),
      ),
    ).toBe("jpeg");
  });

  it("does not match a signature that diverges on the final byte", () => {
    // The signature's own third byte (another marker-prefix 0xff) replaced with a byte that cannot start a marker.
    const JPEG_MARKER_PREFIX_CORRUPTED = 0x00;
    expect(
      sniffImageFormat(
        new Uint8Array([
          JPEG_MARKER_PREFIX,
          JPEG_SOI_MARKER,
          JPEG_MARKER_PREFIX_CORRUPTED,
        ]),
      ),
    ).toBeUndefined();
  });
});

describe("sniffImageFormat: GIF", () => {
  // Mirrors sniff.ts's own (unexported) GIF_SIGNATURE_* consts: GIF87a and GIF89a both spell out "GIF8" followed by a two-ASCII-digit version and a trailing "a".
  const GIF_SIGNATURE_G = 0x47;
  const GIF_SIGNATURE_I = 0x49;
  const GIF_SIGNATURE_F = 0x46;
  const GIF_SIGNATURE_8 = 0x38;
  const GIF_SIGNATURE_VERSION_87 = 0x37; // ASCII '7'.
  const GIF_SIGNATURE_VERSION_89 = 0x39; // ASCII '9'.
  const GIF_SIGNATURE_A = 0x61;

  it("detects the GIF87a signature", () => {
    const bytes = new Uint8Array([
      GIF_SIGNATURE_G,
      GIF_SIGNATURE_I,
      GIF_SIGNATURE_F,
      GIF_SIGNATURE_8,
      GIF_SIGNATURE_VERSION_87,
      GIF_SIGNATURE_A,
      1,
      2,
    ]);
    expect(sniffImageFormat(bytes)).toBe("gif");
  });

  it("detects the GIF89a signature", () => {
    const bytes = new Uint8Array([
      GIF_SIGNATURE_G,
      GIF_SIGNATURE_I,
      GIF_SIGNATURE_F,
      GIF_SIGNATURE_8,
      GIF_SIGNATURE_VERSION_89,
      GIF_SIGNATURE_A,
      1,
      2,
    ]);
    expect(sniffImageFormat(bytes)).toBe("gif");
  });

  it("does not match a GIF-like prefix that diverges on the version byte", () => {
    // Neither GIF87a's '7' nor GIF89a's '9': a version digit no real GIF header ever defined.
    const GIF_SIGNATURE_VERSION_INVALID = 0x30; // ASCII '0'.
    const bytes = new Uint8Array([
      GIF_SIGNATURE_G,
      GIF_SIGNATURE_I,
      GIF_SIGNATURE_F,
      GIF_SIGNATURE_8,
      GIF_SIGNATURE_VERSION_INVALID,
      GIF_SIGNATURE_A,
    ]);
    expect(sniffImageFormat(bytes)).toBeUndefined();
  });
});

describe("sniffImageFormat: SVG", () => {
  it("detects an SVG that opens directly with the root <svg> tag", () => {
    const bytes = new Uint8Array(enc('<svg xmlns="x"><path/></svg>'));
    expect(sniffImageFormat(bytes)).toBe("svg");
  });

  it("detects an SVG whose root tag is preceded by an XML prolog", () => {
    const bytes = new Uint8Array(
      enc('<?xml version="1.0"?><svg xmlns="x"></svg>'),
    );
    expect(sniffImageFormat(bytes)).toBe("svg");
  });

  it("detects an SVG whose root/prolog is preceded by leading whitespace", () => {
    const bytes = new Uint8Array(enc('   \n\t<svg xmlns="x"></svg>'));
    expect(sniffImageFormat(bytes)).toBe("svg");
  });

  it("does not detect an SVG signature in plain, unrelated text", () => {
    const bytes = new Uint8Array(enc("just some text, not a document"));
    expect(sniffImageFormat(bytes)).toBeUndefined();
  });

  it("does not detect an SVG signature in an empty byte array", () => {
    expect(sniffImageFormat(new Uint8Array([]))).toBeUndefined();
  });

  it("only sniffs the leading 1024-byte window, never a '<svg' tag that appears only later in a longer document", () => {
    // Non-SVG filler, with a real '<svg' root tag starting well past sniff.ts's own 1024-byte SVG_SNIFF_WINDOW: the real function must never find it there.
    const FILLER_BYTE_COUNT = 2000;
    const FILLER_BYTE = 0x2e; // ASCII '.'.
    const SVG_TAIL_OFFSET = 1500;
    const filler = new Uint8Array(FILLER_BYTE_COUNT).fill(FILLER_BYTE);
    const svgTail = enc("<svg xmlns='x'></svg>");
    const bytes = new Uint8Array(FILLER_BYTE_COUNT + svgTail.length);
    bytes.set(filler, 0);
    bytes.set(svgTail, SVG_TAIL_OFFSET);
    expect(sniffImageFormat(bytes)).toBeUndefined();
  });
});

describe("sniffImageFormat: no format recognised", () => {
  it("returns undefined for bytes matching none of the known signatures", () => {
    // Five arbitrary bytes matching no known signature's own leading bytes: their exact values carry no meaning, so they simply count upward.
    const ARBITRARY_UNRECOGNISED_BYTE_COUNT = 5;
    const bytes = new Uint8Array(
      Array.from(
        { length: ARBITRARY_UNRECOGNISED_BYTE_COUNT },
        (_unused, index) => index + 1,
      ),
    );
    expect(sniffImageFormat(bytes)).toBeUndefined();
  });
});
