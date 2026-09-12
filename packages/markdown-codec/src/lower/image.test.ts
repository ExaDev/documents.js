import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "../image/image";
import { resolveMarkdownImage } from "./image";

// A minimal, otherwise-valid PNG signature + IHDR chunk with an asymmetric width/height (300x100) so a widthPt/heightPt swap or a wrong operator on either axis produces a value distinct from the other, rather than two coincidentally-equal numbers.
function pngBytes(widthPx: number, heightPx: number): Uint8Array {
  const bytes = new Uint8Array(29);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR chunk length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // 'IHDR'
  const view = new DataView(bytes.buffer);
  view.setUint32(16, widthPx, false);
  view.setUint32(20, heightPx, false);
  return bytes;
}

const CSS_PIXELS_PER_INCH = 96;
const POINTS_PER_INCH = 72;
const POINTS_PER_PIXEL = POINTS_PER_INCH / CSS_PIXELS_PER_INCH;

describe("resolveMarkdownImage", () => {
  it("converts an asymmetric PNG's own width/height in pixels to points independently, on the correct axis", () => {
    const png = pngBytes(300, 100);
    const destination = `data:image/png;base64,${bytesToBase64(png)}`;
    const resolved = resolveMarkdownImage(destination, { alt: "" }, undefined);
    expect(resolved?.widthPt).toBeCloseTo(300 * POINTS_PER_PIXEL);
    expect(resolved?.heightPt).toBeCloseTo(100 * POINTS_PER_PIXEL);
  });
});
