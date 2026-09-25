import { describe, expect, it } from "vitest";
import { sniffImageFormat } from "./sniff";

function bytesOf(values: readonly number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(values);
}

function asciiBytes(text: string): number[] {
  return Array.from(text, (c) => c.charCodeAt(0));
}

// Mirrors sniff.ts's own PNG signature derivation.
const PNG_SIGNATURE_HIGH_BIT_MARKER = 0x89;
const PNG_SIGNATURE = [
  PNG_SIGNATURE_HIGH_BIT_MARKER,
  ...Array.from("PNG\r\n\x1a\n", (char) => char.charCodeAt(0)),
];
const TRAILING_BYTE = 0xff;
const JPEG_MARKER_PREFIX = 0xff;
const JPEG_SOI = 0xd8;
const JPEG_APP0 = 0xe0;

describe("sniffImageFormat", () => {
  it("detects a PNG from its 8-byte magic signature", () => {
    expect(sniffImageFormat(bytesOf([...PNG_SIGNATURE, TRAILING_BYTE]))).toBe(
      "png",
    );
  });

  it("detects a JPEG from its 3-byte magic signature", () => {
    expect(
      sniffImageFormat(
        bytesOf([JPEG_MARKER_PREFIX, JPEG_SOI, JPEG_MARKER_PREFIX, JPEG_APP0]),
      ),
    ).toBe("jpeg");
  });

  it("detects a GIF87a header", () => {
    expect(sniffImageFormat(bytesOf(asciiBytes("GIF87a").concat([0x00])))).toBe(
      "gif",
    );
  });

  it("detects a GIF89a header", () => {
    expect(sniffImageFormat(bytesOf(asciiBytes("GIF89a").concat([0x00])))).toBe(
      "gif",
    );
  });

  it("returns undefined for bytes shorter than every signature it checks", () => {
    expect(
      sniffImageFormat(bytesOf(PNG_SIGNATURE.slice(0, 2))),
    ).toBeUndefined();
  });

  it("returns undefined for an empty byte array", () => {
    expect(sniffImageFormat(bytesOf([]))).toBeUndefined();
  });

  it("detects SVG from an XML prolog, with no '<svg' tag present in the sniffed window", () => {
    const bytes = bytesOf(asciiBytes('<?xml version="1.0"?><notsvg/>'));
    expect(sniffImageFormat(bytes)).toBe("svg");
  });

  it("detects SVG from a bare '<svg' root tag, with no XML prolog", () => {
    const bytes = bytesOf(
      asciiBytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    );
    expect(sniffImageFormat(bytes)).toBe("svg");
  });

  it("skips leading whitespace before the '<?xml' prolog", () => {
    const bytes = bytesOf(asciiBytes('   <?xml version="1.0"?><svg/>'));
    expect(sniffImageFormat(bytes)).toBe("svg");
  });

  it("returns undefined for text that starts with neither '<?xml' nor '<svg'", () => {
    const bytes = bytesOf(asciiBytes("<html><body/></html>"));
    expect(sniffImageFormat(bytes)).toBeUndefined();
  });

  it("never finds a root element hidden behind more leading whitespace than the sniff window covers", () => {
    // The sniff window is capped at a fixed size specifically so a caller can't be made to scan an unboundedly large file — a real SVG's root element always appears well within it (see sniff.ts's own comment), so padding past the window with plain spaces before the real tag is exactly the case the cap is meant to give up on, not a bug to work around.
    const paddingLength = 2000;
    const asciiSpace = 0x20;
    const sniffWindowBytes = 1024;
    const bytes = bytesOf([
      ...Array<number>(paddingLength).fill(asciiSpace),
      ...asciiBytes("<?xml?>"),
    ]);
    expect(bytes.length).toBeGreaterThan(sniffWindowBytes);
    expect(sniffImageFormat(bytes)).toBeUndefined();
  });

  it("does not match bytes that merely end with, rather than start with, an SVG marker", () => {
    const bytes = bytesOf(
      asciiBytes("<html>embeds a literal <?xml tag</html>"),
    );
    expect(sniffImageFormat(bytes)).toBeUndefined();
  });
});
