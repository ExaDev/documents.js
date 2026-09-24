import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "byte-codec";
import { resolveMarkdownImage } from "./image";

// PNG's own 8-byte file signature: a byte with the high bit set (so a 7-bit text-mode transfer corrupts it detectably), then "PNG\r\n\x1a\n", a CRLF, a DOS EOF marker, and a final LF, each chosen to detect a different common file-transfer corruption.
const PNG_SIGNATURE_HIGH_BIT_MARKER = 0x89;
const PNG_SIGNATURE = [
  PNG_SIGNATURE_HIGH_BIT_MARKER,
  ...Array.from("PNG\r\n\x1a\n", (char) => char.charCodeAt(0)),
];
const PNG_SIGNATURE_OFFSET = 0;
// The IHDR chunk's own 4-byte big-endian data length, always 13 bytes (width + height + bit depth + colour type + compression + filter + interlace).
const IHDR_DATA_LENGTH = 13;
const IHDR_LENGTH_BYTES = [0x00, 0x00, 0x00, IHDR_DATA_LENGTH];
const IHDR_LENGTH_OFFSET = 8;
const IHDR_TYPE_BYTES = Array.from("IHDR", (char) => char.charCodeAt(0));
const IHDR_TYPE_OFFSET = 12;
const IHDR_WIDTH_OFFSET = 16;
const IHDR_HEIGHT_OFFSET = 20;
// Signature (8) + length (4) + type (4) + IHDR data (13) = 29 bytes total; enough for width/height, not the trailing CRC or any later chunk.
const PNG_HEADER_LENGTH = 29;

// A minimal, otherwise-valid PNG signature + IHDR chunk with an asymmetric width/height so a widthPt/heightPt swap or a wrong operator on either axis produces a value distinct from the other, rather than two coincidentally-equal numbers.
function pngBytes(widthPx: number, heightPx: number): Uint8Array {
  const bytes = new Uint8Array(PNG_HEADER_LENGTH);
  bytes.set(PNG_SIGNATURE, PNG_SIGNATURE_OFFSET);
  bytes.set(IHDR_LENGTH_BYTES, IHDR_LENGTH_OFFSET);
  bytes.set(IHDR_TYPE_BYTES, IHDR_TYPE_OFFSET);
  const view = new DataView(bytes.buffer);
  view.setUint32(IHDR_WIDTH_OFFSET, widthPx, false);
  view.setUint32(IHDR_HEIGHT_OFFSET, heightPx, false);
  return bytes;
}

const CSS_PIXELS_PER_INCH = 96;
const POINTS_PER_INCH = 72;
const POINTS_PER_PIXEL = POINTS_PER_INCH / CSS_PIXELS_PER_INCH;

describe("resolveMarkdownImage", () => {
  it("converts an asymmetric PNG's own width/height in pixels to points independently, on the correct axis", () => {
    const widthPx = 300;
    const heightPx = 100;
    const png = pngBytes(widthPx, heightPx);
    const destination = `data:image/png;base64,${bytesToBase64(png)}`;
    const resolved = resolveMarkdownImage(destination, { alt: "" }, undefined);
    expect(resolved?.widthPt).toBeCloseTo(widthPx * POINTS_PER_PIXEL);
    expect(resolved?.heightPt).toBeCloseTo(heightPx * POINTS_PER_PIXEL);
  });
});
